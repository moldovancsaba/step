//! libp2p gossip swarm (#54) — the network I/O that drives the pure `Engine`.
//!
//! Identity is the validator's secp256k1 key, so a peer id IS a validator. Two
//! gossipsub topics carry claims and votes; peers are found by mDNS on the LAN
//! and by explicit self-hosted bootstrap multiaddrs cross-location — there is no
//! third-party signaling server. On a fresh claim the node asks its co-located
//! validator to validate+sign (HTTP), publishes the resulting vote, and on a
//! completed weighted quorum submits the bundle. The swarm holds no consensus
//! logic — it only moves bytes in and out of `Engine`.

use crate::config::GossipConfig;
use crate::engine::{Action, Engine};
use crate::messages::{ClaimMsg, Gossip, VoteMsg};
use futures::StreamExt;
use libp2p::swarm::{NetworkBehaviour, SwarmEvent};
use libp2p::{gossipsub, identity, mdns, noise, tcp, yamux, Multiaddr};
use std::time::Duration;

pub const CLAIMS_TOPIC: &str = "step/claims/v1";
pub const VOTES_TOPIC: &str = "step/votes/v1";

#[derive(NetworkBehaviour)]
struct Behaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
}

/// Build a libp2p keypair from the validator's secp256k1 secret key bytes, so the
/// gossip peer identity is cryptographically tied to the on-chain validator.
fn keypair_from_validator(key: &[u8; 32]) -> Result<identity::Keypair, String> {
    let mut bytes = *key; // try_into_bytes zeroizes its input
    let secret = identity::secp256k1::SecretKey::try_from_bytes(&mut bytes)
        .map_err(|e| format!("bad validator key for libp2p identity: {e}"))?;
    Ok(identity::Keypair::from(identity::secp256k1::Keypair::from(
        secret,
    )))
}

/// Ask the co-located validator to validate + sign a claim. Returns the node's
/// own signed vote, or `None` if the validator rejects/declines or is unreachable.
async fn validate_and_sign(
    client: &reqwest::Client,
    validator_url: &str,
    claim: &ClaimMsg,
) -> Option<VoteMsg> {
    let url = format!("{}/validate", validator_url.trim_end_matches('/'));
    let body = serde_json::json!({ "claim": claim.claim });
    let resp = client.post(&url).json(&body).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = resp.json().await.ok()?;
    // The validator returns { verdict, vote, ... }; only an approval is worth
    // gossiping (a rejection carries no weight).
    if v.get("verdict").and_then(|x| x.get("approve")) != Some(&serde_json::Value::Bool(true)) {
        return None;
    }
    serde_json::from_value(v.get("vote")?.clone()).ok()
}

/// Run the gossip node until shutdown. `submit` is invoked with a finalised
/// quorum bundle (it performs the on-chain submission); `weight_of` reads a
/// validator's on-chain active weight.
pub async fn run<S, Fut, W, WFut>(
    cfg: GossipConfig,
    mut submit: S,
    weight_of: W,
) -> Result<(), String>
where
    S: FnMut(crate::aggregate::Bundle) -> Fut,
    Fut: std::future::Future<Output = ()>,
    W: Fn(step_validation_rules::sign::Address) -> WFut,
    WFut: std::future::Future<Output = u128>,
{
    let keypair = keypair_from_validator(&cfg.validator_key)?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )
        .map_err(|e| format!("tcp transport: {e}"))?
        .with_behaviour(|key| {
            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gossipsub::ConfigBuilder::default()
                    .validation_mode(gossipsub::ValidationMode::Strict)
                    .build()
                    .map_err(|e| std::io::Error::other(e.to_string()))?,
            )
            .map_err(std::io::Error::other)?;
            let mdns =
                mdns::tokio::Behaviour::new(mdns::Config::default(), key.public().to_peer_id())?;
            Ok(Behaviour { gossipsub, mdns })
        })
        .map_err(|e| format!("behaviour: {e}"))?
        .build();

    let claims_topic = gossipsub::IdentTopic::new(CLAIMS_TOPIC);
    let votes_topic = gossipsub::IdentTopic::new(VOTES_TOPIC);
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&claims_topic)
        .map_err(|e| format!("subscribe claims: {e}"))?;
    swarm
        .behaviour_mut()
        .gossipsub
        .subscribe(&votes_topic)
        .map_err(|e| format!("subscribe votes: {e}"))?;

    swarm
        .listen_on(
            cfg.listen
                .parse()
                .map_err(|e| format!("bad GOSSIP_LISTEN: {e}"))?,
        )
        .map_err(|e| format!("listen: {e}"))?;
    for b in &cfg.bootstrap {
        match b.parse::<Multiaddr>() {
            Ok(addr) => {
                if let Err(e) = swarm.dial(addr) {
                    tracing::warn!("dial {b} failed: {e}");
                }
            }
            Err(e) => tracing::warn!("bad bootstrap addr {b}: {e}"),
        }
    }

    let mut engine = Engine::new(
        cfg.chain_id,
        cfg.verifying_contract,
        cfg.quorum_threshold,
        cfg.seen_capacity,
    );
    // Persistent weight cache: the aggregator needs the weight of EVERY validator
    // that has voted on a claim, not just the latest one, so weights accumulate
    // here across votes. Weights change rarely; a missing one is resolved once.
    let mut weights: std::collections::HashMap<step_validation_rules::sign::Address, u128> =
        std::collections::HashMap::new();
    tracing::info!(peer = %swarm.local_peer_id(), "gossip node started");

    loop {
        let event = swarm.select_next_some().await;
        match event {
            SwarmEvent::Behaviour(BehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                for (peer, _addr) in list {
                    swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer);
                    tracing::debug!(%peer, "mDNS discovered peer");
                }
            }
            SwarmEvent::Behaviour(BehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                for (peer, _addr) in list {
                    swarm.behaviour_mut().gossipsub.remove_explicit_peer(&peer);
                }
            }
            SwarmEvent::Behaviour(BehaviourEvent::Gossipsub(gossipsub::Event::Message {
                message,
                ..
            })) => {
                let Some(fresh) = engine.decode_fresh(&message.data) else {
                    continue; // malformed or replay
                };
                let actions = match fresh {
                    Gossip::Vote(vote) => {
                        cache_weight(&mut weights, &weight_of, vote.validator_address()).await;
                        engine.ingest_vote(vote, &|a| weights.get(a).copied().unwrap_or(0))
                    }
                    Gossip::Claim(claim) => {
                        match validate_and_sign(&http, &cfg.validator_url, &claim).await {
                            Some(my_vote) => {
                                cache_weight(&mut weights, &weight_of, my_vote.validator_address())
                                    .await;
                                engine
                                    .vote_actions(my_vote, |a| weights.get(a).copied().unwrap_or(0))
                            }
                            None => vec![],
                        }
                    }
                };
                for action in actions {
                    match action {
                        Action::Publish(g) => {
                            if let Err(e) = swarm
                                .behaviour_mut()
                                .gossipsub
                                .publish(votes_topic.clone(), g.encode())
                            {
                                tracing::debug!("publish vote failed: {e}");
                            }
                        }
                        Action::Submit(bundle) => {
                            tracing::info!(
                                claim = %bundle.claim_hash,
                                weight = bundle.total_weight,
                                approvals = bundle.approvals.len(),
                                "weighted quorum reached — submitting bundle"
                            );
                            submit(bundle).await;
                        }
                    }
                }
            }
            SwarmEvent::NewListenAddr { address, .. } => {
                tracing::info!(%address, "listening");
            }
            _ => {}
        }
    }
}

/// Ensure `addr`'s on-chain weight is in the cache, resolving it once if missing.
async fn cache_weight<W, WFut>(
    cache: &mut std::collections::HashMap<step_validation_rules::sign::Address, u128>,
    weight_of: &W,
    addr: Option<step_validation_rules::sign::Address>,
) where
    W: Fn(step_validation_rules::sign::Address) -> WFut,
    WFut: std::future::Future<Output = u128>,
{
    if let Some(a) = addr {
        if let std::collections::hash_map::Entry::Vacant(slot) = cache.entry(a) {
            let w = weight_of(a).await;
            slot.insert(w);
        }
    }
}
