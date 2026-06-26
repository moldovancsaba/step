//! `step-node-agent` entrypoint (#40-#42): supervises the validator, self-updates
//! from the on-chain ReleaseRegistry with failsafe rollback, and continuously
//! checks its own integrity. Runs as a system service (#44), not in the foreground.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use step_node_agent::chain::ChainReader;
use step_node_agent::config::AgentConfig;
use step_node_agent::hashes::measure_dir;
use step_node_agent::integrity::{evaluate, Verdict};
use step_node_agent::layout::Layout;
use step_node_agent::supervisor::{HealthCanary, HttpFetcher, ProcessSupervisor};
use step_node_agent::update::{perform_update, Outcome, Supervisor};
use step_node_agent::{backoff_ms, format_semver, parse_semver};

#[derive(Clone, Serialize, Default)]
struct StatusReport {
    node: String,
    platform: String,
    current_version: Option<String>,
    target_version: Option<String>,
    child_health: String,
    integrity: String,
    /// Set when the hub/chain is unreachable: the node keeps running its current
    /// verified version and retries; it does NOT roll back or run unverified code.
    degraded: Option<String>,
    last_action: String,
    updated_at: String,
}

type Shared = Arc<Mutex<StatusReport>>;

#[derive(Clone)]
struct AppState {
    status: Shared,
    artifacts: ArtifactState,
}

#[derive(Clone)]
struct ArtifactState {
    platform: String,
    releases_dir: std::path::PathBuf,
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch:{secs}")
}

#[tokio::main]
async fn main() {
    // Keyless provisioning: `--init` generates the node's own identity key, stores
    // it in the OS secret store, prints its address, and exits — so a public
    // installer can stand up a node with NO secret ever travelling. The operator
    // then registers the printed address on the hub.
    if std::env::args().any(|a| a == "--init") {
        init_identity();
        return;
    }

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

    let app_state = AppState {
        status,
        artifacts: ArtifactState {
            platform: cfg.platform.clone(),
            releases_dir: cfg.root.join("releases"),
        },
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/agent/status", get(status_handler))
        .route("/artifacts/status", get(artifact_status_handler))
        .route("/artifacts/{platform}/{version}", get(artifact_handler))
        .route(
            "/artifacts/{platform}/{version}/{part}",
            get(artifact_part_handler),
        )
        .with_state(app_state);
    let addr = format!("0.0.0.0:{}", cfg.agent_port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind agent port");
    tracing::info!("node-agent status on {addr}");
    axum::serve(listener, app).await.expect("serve");
}

/// `--init`: generate the node identity key, store it, print `NODE_ADDRESS=0x…`.
fn init_identity() {
    use step_validation_rules::sign::{address_from_key_bytes, generate_key_bytes};
    let key = generate_key_bytes().unwrap_or_else(|e| {
        eprintln!("entropy error: {e}");
        std::process::exit(2);
    });
    let addr = address_from_key_bytes(&key).expect("generated key is valid");
    let address = format!("0x{}", hex::encode(addr));
    let secrets = step_node_agent::secrets::Secrets::from_env(&address);
    if let Err(e) = secrets.store("validatorKey", &format!("0x{}", hex::encode(key))) {
        eprintln!("could not store key: {e}");
        std::process::exit(1);
    }
    // The shared gateway nonce secret is federation config (not node-generated);
    // store it alongside if the installer passed it.
    if let Ok(ns) = std::env::var("GATEWAY_NONCE_SECRET") {
        let _ = secrets.store("nonceSecret", &ns);
    }
    // The one line the installer captures to wire the service + that the operator
    // registers on the hub. Keep it the ONLY stdout line.
    println!("NODE_ADDRESS={address}");
}

async fn status_handler(State(s): State<AppState>) -> Json<StatusReport> {
    Json(s.status.lock().expect("status lock").clone())
}

#[derive(Serialize)]
struct ArtifactStatus {
    platform: String,
    releases: Vec<ArtifactReleaseStatus>,
}

#[derive(Serialize)]
struct ArtifactReleaseStatus {
    version: String,
    package: bool,
    manifest: bool,
    chunks: usize,
}

async fn artifact_status_handler(State(s): State<AppState>) -> Json<ArtifactStatus> {
    let mut releases = Vec::new();
    if let Ok(mut dir) = tokio::fs::read_dir(&s.artifacts.releases_dir).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(packed) = name.parse::<u64>() else {
                continue;
            };
            let path = entry.path();
            let package = tokio::fs::metadata(path.join("step-validator-node"))
                .await
                .map(|m| m.is_file())
                .unwrap_or(false);
            let manifest = tokio::fs::metadata(path.join("manifest.json"))
                .await
                .map(|m| m.is_file())
                .unwrap_or(false);
            let chunks = count_chunks(path.join("chunks")).await;
            releases.push(ArtifactReleaseStatus {
                version: format_semver(packed),
                package,
                manifest,
                chunks,
            });
        }
    }
    Json(ArtifactStatus {
        platform: s.artifacts.platform,
        releases,
    })
}

async fn count_chunks(path: std::path::PathBuf) -> usize {
    let mut count = 0;
    if let Ok(mut dir) = tokio::fs::read_dir(path).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            if entry.metadata().await.map(|m| m.is_file()).unwrap_or(false) {
                count += 1;
            }
        }
    }
    count
}

/// Peer artifact seeding endpoint.
///
/// This deliberately serves only already-staged release binaries from the local
/// release cache. Consumers must still verify bytes against ReleaseRegistry
/// hashes before activation, so this endpoint is a transport/cache, not trust.
async fn artifact_handler(
    State(s): State<AppState>,
    AxumPath((platform, version)): AxumPath<(String, String)>,
) -> Response {
    serve_artifact(&s.artifacts, &platform, &version, "package").await
}

async fn artifact_part_handler(
    State(s): State<AppState>,
    AxumPath((platform, version, part)): AxumPath<(String, String, String)>,
) -> Response {
    serve_artifact(&s.artifacts, &platform, &version, &part).await
}

async fn serve_artifact(
    artifacts: &ArtifactState,
    platform: &str,
    version: &str,
    part: &str,
) -> Response {
    if platform != artifacts.platform {
        return (StatusCode::NOT_FOUND, "platform_not_available").into_response();
    }
    let Some(packed) = parse_semver(version) else {
        return (StatusCode::BAD_REQUEST, "bad_version").into_response();
    };
    let release_dir = artifacts.releases_dir.join(packed.to_string());
    let (path, content_type) = match part {
        "package" => (
            release_dir.join("step-validator-node"),
            "application/octet-stream",
        ),
        "manifest.json" | "manifest" => (release_dir.join("manifest.json"), "application/json"),
        p if p.starts_with("chunks-") => {
            let idx = p.trim_start_matches("chunks-");
            if idx.is_empty() || idx.contains('/') || idx.contains("..") {
                return (StatusCode::BAD_REQUEST, "bad_chunk").into_response();
            }
            (
                release_dir.join("chunks").join(idx),
                "application/octet-stream",
            )
        }
        _ => return (StatusCode::NOT_FOUND, "unknown_artifact_part").into_response(),
    };
    let meta = match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_file() => meta,
        _ => return (StatusCode::NOT_FOUND, "artifact_not_staged").into_response(),
    };
    if meta.len() > 256 * 1024 * 1024 {
        return (StatusCode::PAYLOAD_TOO_LARGE, "artifact_too_large").into_response();
    }
    match tokio::fs::read(&path).await {
        Ok(bytes) if part == "manifest" || part == "manifest.json" => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, "public, max-age=60"),
            ],
            bytes,
        )
            .into_response(),
        Ok(bytes) => {
            let digest = format!("0x{}", hex::encode(Sha256::digest(&bytes)));
            let mut response = (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
                ],
                bytes,
            )
                .into_response();
            if let Ok(value) = digest.parse() {
                response.headers_mut().insert(
                    header::HeaderName::from_static("x-step-content-sha256"),
                    value,
                );
            }
            response
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "artifact_read_failed").into_response(),
    }
}

fn set<F: FnOnce(&mut StatusReport)>(s: &Shared, f: F) {
    let mut g = s.lock().expect("status lock");
    f(&mut g);
    g.updated_at = now_iso();
}

fn control_loop(cfg: AgentConfig, status: Shared) {
    let layout = Layout::new(&cfg.root).expect("layout");
    let chain = ChainReader::new(&cfg.rpc_urls, &cfg.release_registry, &cfg.platform_id)
        .expect("chain reader");
    let secrets = step_node_agent::secrets::Secrets::from_env(&cfg.node_address);
    // Cache the node key bytes once for signed heartbeats (#56). Absent ⇒ no
    // heartbeats (the node still runs; the hub just sees it via on-chain weight).
    let hb_key: Option<Vec<u8>> = cfg.fleet_url.as_ref().and_then(|_| {
        secrets
            .get("validatorKey")
            .and_then(|k| hex::decode(k.strip_prefix("0x").unwrap_or(&k)).ok())
            .filter(|b| b.len() == 32)
    });
    if cfg.fleet_url.is_some() && hb_key.is_none() {
        tracing::warn!("FLEET_URL set but node key unavailable — heartbeats disabled");
    }
    let hb_client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("heartbeat client");
    let supervisor = ProcessSupervisor::new(&layout, cfg.validator_port, secrets.clone());
    let fetcher = if cfg.artifact_base_urls.is_empty() {
        None
    } else {
        Some(HttpFetcher::new(
            &cfg.artifact_base_urls,
            &cfg.platform,
            &layout,
        ))
    };
    let canary = HealthCanary::new(cfg.agent_port.wrapping_add(1000), secrets);

    // Start the validator if we already have a current release.
    if layout.current().is_some() {
        let _ = supervisor.restart();
    }

    let mut last_integrity = Instant::now()
        .checked_sub(cfg.integrity_interval)
        .unwrap_or_else(Instant::now);
    // Emit the first heartbeat promptly (so the hub sees a fresh node fast).
    let mut last_heartbeat = Instant::now()
        .checked_sub(cfg.heartbeat_interval)
        .unwrap_or_else(Instant::now);
    // Consecutive hub-unreachable failures → exponential backoff + degraded status
    // (#51). The node keeps running its current verified version throughout.
    let mut fail_streak: u32 = 0;

    loop {
        // 1. resolve the authorized target from chain
        let mut hub_unreachable = false;
        match chain.effective_target(&cfg.node_address) {
            Ok(Some(target)) => {
                set(&status, |s| {
                    s.target_version = Some(format_semver(target.version));
                    s.degraded = None;
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
                s.degraded = None;
                s.last_action = "no active on-chain release".into()
            }),
            Err(e) => {
                hub_unreachable = true;
                tracing::warn!("chain read failed: {e}");
                set(&status, |s| {
                    s.degraded = Some(format!("hub/chain unreachable: {e}"));
                });
            }
        }

        // 2. continuous self-integrity (skip while the hub is unreachable — the
        //    baseline is unreadable; fail-closed means hold, not quarantine).
        if !hub_unreachable && last_integrity.elapsed() >= cfg.integrity_interval {
            last_integrity = Instant::now();
            run_integrity(&layout, &chain, &supervisor, &status);
        }

        // 3. reflect health
        set(&status, |s| {
            s.current_version = layout.current().map(format_semver);
            s.child_health = if supervisor.healthy() { "up" } else { "down" }.into();
        });

        // 3b. emit a signed heartbeat to the hub (#56) — hub-independent, anti-spoof
        //     supervision signal. Best-effort: a delivery failure is non-fatal.
        if let (Some(fleet_url), Some(key)) = (&cfg.fleet_url, &hb_key) {
            if last_heartbeat.elapsed() >= cfg.heartbeat_interval {
                last_heartbeat = Instant::now();
                emit_heartbeat(&hb_client, fleet_url, key, &status);
            }
        }

        // 4. sleep until next poll — normal cadence, or exponential backoff (+jitter)
        //    while the hub is unreachable so we don't hammer it or flap.
        if hub_unreachable {
            fail_streak = fail_streak.saturating_add(1);
            let base = cfg.poll_interval.as_millis().min(u128::from(u64::MAX)) as u64;
            let backoff = backoff_ms(fail_streak, base.max(1000), 60_000);
            // deterministic small jitter from the node address (no RNG dependency)
            let jitter = (cfg.node_address.bytes().map(u64::from).sum::<u64>() % 1000)
                .saturating_mul(fail_streak.min(10) as u64);
            std::thread::sleep(Duration::from_millis(backoff.saturating_add(jitter)));
        } else {
            fail_streak = 0;
            std::thread::sleep(cfg.poll_interval);
        }
    }
}

/// Build and POST a signed heartbeat from the current status snapshot (#56).
fn emit_heartbeat(
    client: &reqwest::blocking::Client,
    fleet_url: &str,
    key: &[u8],
    status: &Shared,
) {
    let (version, health, integrity, degraded) = {
        let s = status.lock().expect("status lock");
        (
            s.current_version.clone().unwrap_or_else(|| "0.0.0".into()),
            // The wire contract is health ∈ {up,down}; "quarantined" is carried in
            // the integrity field, so map a quarantined child to down here.
            if s.child_health == "up" { "up" } else { "down" }.to_string(),
            if s.integrity.starts_with("quarantined") {
                "quarantined"
            } else {
                "ok"
            }
            .to_string(),
            s.degraded.clone(),
        )
    };
    let Some(hb) = step_node_agent::heartbeat::build_signed(
        key,
        &version,
        &health,
        &integrity,
        &now_iso(),
        degraded.as_deref(),
    ) else {
        tracing::warn!("could not build heartbeat (bad node key)");
        return;
    };
    if let Err(e) = step_node_agent::heartbeat::post(client, fleet_url, &hb) {
        tracing::debug!("heartbeat delivery failed (non-fatal): {e}");
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
