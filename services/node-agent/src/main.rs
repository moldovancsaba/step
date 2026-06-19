//! `step-node-agent` entrypoint (#40-#42): supervises the validator, self-updates
//! from the on-chain ReleaseRegistry with failsafe rollback, and continuously
//! checks its own integrity. Runs as a system service (#44), not in the foreground.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use step_node_agent::chain::ChainReader;
use step_node_agent::config::AgentConfig;
use step_node_agent::format_semver;
use step_node_agent::hashes::measure_dir;
use step_node_agent::integrity::{evaluate, Verdict};
use step_node_agent::layout::Layout;
use step_node_agent::supervisor::{HealthCanary, HttpFetcher, ProcessSupervisor};
use step_node_agent::update::{perform_update, Outcome, Supervisor};

#[derive(Clone, Serialize, Default)]
struct StatusReport {
    node: String,
    platform: String,
    current_version: Option<String>,
    target_version: Option<String>,
    child_health: String,
    integrity: String,
    last_action: String,
    updated_at: String,
}

type Shared = Arc<Mutex<StatusReport>>;

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch:{secs}")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .json()
        .init();

    let cfg = AgentConfig::from_env().unwrap_or_else(|e| {
        eprintln!("configuration error: {e}");
        std::process::exit(2);
    });

    let status: Shared = Arc::new(Mutex::new(StatusReport {
        node: cfg.node_address.clone(),
        platform: cfg.platform.clone(),
        last_action: "starting".into(),
        updated_at: now_iso(),
        ..Default::default()
    }));

    // Control loop runs on a dedicated OS thread (blocking chain/HTTP work), so it
    // never blocks the async status server.
    let loop_status = status.clone();
    let loop_cfg = cfg.clone();
    std::thread::spawn(move || control_loop(loop_cfg, loop_status));

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/agent/status", get(status_handler))
        .with_state(status);
    let addr = format!("0.0.0.0:{}", cfg.agent_port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind agent port");
    tracing::info!("node-agent status on {addr}");
    axum::serve(listener, app).await.expect("serve");
}

async fn status_handler(State(s): State<Shared>) -> Json<StatusReport> {
    Json(s.lock().expect("status lock").clone())
}

fn set<F: FnOnce(&mut StatusReport)>(s: &Shared, f: F) {
    let mut g = s.lock().expect("status lock");
    f(&mut g);
    g.updated_at = now_iso();
}

fn control_loop(cfg: AgentConfig, status: Shared) {
    let layout = Layout::new(&cfg.root).expect("layout");
    let chain = ChainReader::new(&cfg.rpc_url, &cfg.release_registry, &cfg.platform_id)
        .expect("chain reader");
    let secrets = step_node_agent::secrets::Secrets::from_env(&cfg.node_address);
    let supervisor = ProcessSupervisor::new(&layout, cfg.validator_port, secrets.clone());
    let fetcher = cfg
        .artifact_base_url
        .as_deref()
        .map(|u| HttpFetcher::new(u, &cfg.platform, &layout));
    let canary = HealthCanary::new(cfg.agent_port.wrapping_add(1000), secrets);

    // Start the validator if we already have a current release.
    if layout.current().is_some() {
        let _ = supervisor.restart();
    }

    let mut last_integrity = Instant::now()
        .checked_sub(cfg.integrity_interval)
        .unwrap_or_else(Instant::now);

    loop {
        // 1. resolve the authorized target from chain
        match chain.effective_target(&cfg.node_address) {
            Ok(Some(target)) => {
                set(&status, |s| {
                    s.target_version = Some(format_semver(target.version))
                });
                if let Some(fetcher) = &fetcher {
                    let outcome = perform_update(
                        &layout,
                        &target,
                        fetcher,
                        &canary,
                        &supervisor,
                        cfg.watch_attempts,
                        || std::thread::sleep(Duration::from_millis(500)),
                    );
                    record_outcome(&status, &outcome);
                }
            }
            Ok(None) => set(&status, |s| {
                s.last_action = "no active on-chain release".into()
            }),
            Err(e) => {
                tracing::warn!("chain read failed: {e}");
                set(&status, |s| {
                    s.last_action = format!("chain read failed: {e}")
                });
            }
        }

        // 2. continuous self-integrity
        if last_integrity.elapsed() >= cfg.integrity_interval {
            last_integrity = Instant::now();
            run_integrity(&layout, &chain, &supervisor, &status);
        }

        // 3. reflect health + sleep until next poll
        set(&status, |s| {
            s.current_version = layout.current().map(format_semver);
            s.child_health = if supervisor.healthy() { "up" } else { "down" }.into();
        });
        std::thread::sleep(cfg.poll_interval);
    }
}

fn record_outcome(status: &Shared, outcome: &Outcome) {
    let msg = match outcome {
        Outcome::UpToDate => return,
        Outcome::Activated { to, .. } => format!("activated {}", format_semver(*to)),
        Outcome::RolledBack { from, to, reason } => {
            format!(
                "ROLLED BACK {}→{}: {reason}",
                format_semver(*from),
                format_semver(*to)
            )
        }
        Outcome::Aborted { reason } => format!("update aborted: {reason}"),
        Outcome::CircuitOpen { reason } => format!("CIRCUIT OPEN: {reason}"),
    };
    tracing::warn!("update outcome: {msg}");
    set(status, |s| s.last_action = msg);
}

fn run_integrity(
    layout: &Layout,
    chain: &ChainReader,
    supervisor: &ProcessSupervisor,
    status: &Shared,
) {
    let Some(current) = layout.current() else {
        return;
    };
    let measured = match measure_dir(&layout.release_dir(current)) {
        Ok(m) => m,
        Err(e) => {
            set(status, |s| s.integrity = format!("measure error: {e}"));
            return;
        }
    };
    // Authorized baseline for the version actually RUNNING (not the target, which
    // may be newer). None => fail-closed.
    let expected = chain.release_of(current).ok().flatten();
    match evaluate(&measured, expected.as_ref()) {
        Verdict::Ok => set(status, |s| s.integrity = "ok".into()),
        Verdict::Tampered { field } => {
            tracing::error!("TAMPER detected in {field}; quarantining node");
            supervisor.stop(); // stop voting immediately
            set(status, |s| {
                s.integrity = format!("quarantined: {field} modified");
                s.child_health = "quarantined".into();
                s.last_action = format!("TAMPER {field}: quarantined, reporting to hub");
            });
            // The hub (INTEGRITY_ROLE) submits reportTamper on-chain; the agent
            // exposes the finding via status for hub attestation cross-check.
        }
        Verdict::Indeterminate { reason } => set(status, |s| {
            s.integrity = format!("indeterminate (fail-closed): {reason}")
        }),
    }
}
