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
use libp2p::kad::store::MemoryStore;
use libp2p::multiaddr::Protocol;
use libp2p::swarm::behaviour::toggle::Toggle;
use libp2p::swarm::{NetworkBehaviour, SwarmEvent};
use libp2p::{
    dcutr, gossipsub, identify, identity, kad, mdns, noise, relay, tcp, yamux, Multiaddr,
};
use std::time::Duration;

pub const CLAIMS_TOPIC: &str = "step/claims/v1";
pub const VOTES_TOPIC: &str = "step/votes/v1";
const IDENTIFY_PROTO: &str = "/step/1.0.0";

/// Full web3 peer stack — no DNS, no central registry:
/// - gossipsub: claim/vote propagation
/// - mdns: zero-config discovery on the LAN
/// - kademlia (DHT): decentralized global peer discovery
/// - identify: peers exchange their addresses (feeds the DHT + hole-punching)
/// - relay-client + dcutr: NAT traversal so home nodes connect without a public
///   IP or port-forward
/// - relay (server): OFF by default (#67) — only designated public relays serve
///   circuits, with bounded reservations/circuits; ordinary nodes are not open
///   relays.
#[derive(NetworkBehaviour)]
struct Behaviour {
    gossipsub: gossipsub::Behaviour,
    mdns: mdns::tokio::Behaviour,
    kademlia: kad::Behaviour<MemoryStore>,
    identify: identify::Behaviour,
    relay: Toggle<relay::Behaviour>,
    relay_client: relay::client::Behaviour,
    dcutr: dcutr::Behaviour,
}

/// Extract the `/p2p/<PeerId>` component of a bootstrap multiaddr, if present.
fn peer_id_of(addr: &Multiaddr) -> Option<libp2p::PeerId> {
    addr.iter().find_map(|p| match p {
        Protocol::P2p(id) => Some(id),
        _ => None,
    })
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
        .with_quic()
        .with_relay_client(noise::Config::new, yamux::Config::default)
        .map_err(|e| format!("relay client: {e}"))?
        .with_behaviour(|key, relay_client| {
            let peer_id = key.public().to_peer_id();
            let gossipsub = gossipsub::Behaviour::new(
                gossipsub::MessageAuthenticity::Signed(key.clone()),
                gossipsub::ConfigBuilder::default()
                    .validation_mode(gossipsub::ValidationMode::Strict)
                    .build()
                    .map_err(|e| std::io::Error::other(e.to_string()))?,
            )
            .map_err(std::io::Error::other)?;
            let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), peer_id)?;
            let kademlia = kad::Behaviour::new(peer_id, MemoryStore::new(peer_id));
            let identify = identify::Behaviour::new(identify::Config::new(
                IDENTIFY_PROTO.into(),
                key.public(),
            ));
            // #67: relay SERVER only when explicitly enabled, and then bounded.
            let relay = Toggle::from(cfg.relay_server.then(|| {
                let rcfg = relay::Config {
                    max_reservations: cfg.relay_max_reservations,
                    max_circuits: cfg.relay_max_circuits,
                    ..Default::default()
                };
                relay::Behaviour::new(peer_id, rcfg)
            }));
            let dcutr = dcutr::Behaviour::new(peer_id);
            Ok(Behaviour {
                gossipsub,
                mdns,
                kademlia,
                identify,
                relay,
                relay_client,
                dcutr,
            })
        })
        .map_err(|e| format!("behaviour: {e}"))?
        .build();

    // Kademlia in server mode so this node answers DHT queries (helps the network
    // self-organize without any central directory).
    swarm
        .behaviour_mut()
        .kademlia
        .set_mode(Some(kad::Mode::Server));

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
        .map_err(|e| format!("listen tcp: {e}"))?;
    // Also listen on QUIC (UDP) — better through NATs than TCP. L3 (audit): the
    // 0.0.0.0 bind here is INTENTIONAL — a P2P node must be reachable on all
    // interfaces; unlike the dev anvil this exposes no privileged/public-key RPC,
    // only the authenticated gossip protocol.
    if let Ok(quic) = "/ip4/0.0.0.0/udp/0/quic-v1".parse::<Multiaddr>() {
        let _ = swarm.listen_on(quic);
    }

    // Seed peers: a multi-entry bootstrap list (like Bitcoin's seeds) — no single
    // rendezvous point, no DNS. Each is a multiaddr ending in /p2p/<PeerId>; we add
    // it to the DHT routing table and dial it, then let Kademlia discover the rest.
    for b in &cfg.bootstrap {
        match b.parse::<Multiaddr>() {
            Ok(addr) => {
                if let Some(peer) = peer_id_of(&addr) {
                    swarm
                        .behaviour_mut()
                        .kademlia
                        .add_address(&peer, addr.clone());
                }
                if let Err(e) = swarm.dial(addr) {
                    tracing::warn!("dial {b} failed: {e}");
                }
            }
            Err(e) => tracing::warn!("bad bootstrap addr {b}: {e}"),
        }
    }
    // Relay reservations: the line that makes a NAT'd node reachable from anywhere.
    // For each relay multiaddr we `listen_on(<relay>/p2p-circuit)`, which asks the
    // relay for a reservation; the node then advertises `<relay>/p2p-circuit/p2p/<self>`
    // (via identify → DHT) so any peer can reach it without a public IP or
    // port-forward, and dcutr hole-punches that into a direct connection. This is
    // what makes the peer system network-independent rather than LAN-bound.
    for r in &cfg.relays {
        match r.parse::<Multiaddr>() {
            Ok(addr) => {
                if let Some(peer) = peer_id_of(&addr) {
                    swarm
                        .behaviour_mut()
                        .kademlia
                        .add_address(&peer, addr.clone());
                }
                if let Err(e) = swarm.dial(addr.clone()) {
                    tracing::warn!("dial relay {r} failed: {e}");
                    continue;
                }
                let circuit = addr.with(Protocol::P2pCircuit);
                if let Err(e) = swarm.listen_on(circuit.clone()) {
                    tracing::warn!("relay reservation on {r} failed: {e}");
                } else {
                    tracing::info!(%circuit, "requested relay reservation (reachable behind NAT)");
                }
            }
            Err(e) => tracing::warn!("bad relay addr {r}: {e}"),
        }
    }
    // Kick off a DHT bootstrap (ok to fail when there are no seeds yet — mDNS still
    // finds LAN peers, and later joiners will seed us).
    let _ = swarm.behaviour_mut().kademlia.bootstrap();

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
    tracing::info!(
        peer = %swarm.local_peer_id(),
        relay_server = cfg.relay_server,
        "gossip node started (relay-client+dcutr always on; relay-server opt-in)"
    );

    loop {
        let event = swarm.select_next_some().await;
        match event {
            SwarmEvent::Behaviour(BehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                for (peer, addr) in list {
                    swarm.behaviour_mut().gossipsub.add_explicit_peer(&peer);
                    swarm.behaviour_mut().kademlia.add_address(&peer, addr);
                    tracing::debug!(%peer, "mDNS discovered peer");
                }
            }
            // identify tells us a peer's reachable addresses → feed the DHT so the
            // network can route to it without any name service.
            SwarmEvent::Behaviour(BehaviourEvent::Identify(identify::Event::Received {
                peer_id,
                info,
                ..
            })) => {
                for addr in info.listen_addrs {
                    swarm.behaviour_mut().kademlia.add_address(&peer_id, addr);
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
                // Print the address WITH /p2p/<self> appended so it's directly
                // usable as another node's GOSSIP_BOOTSTRAP / GOSSIP_RELAYS entry —
                // no DNS, no IP bookkeeping, just copy the dialable peer address.
                let dialable = address.clone().with(Protocol::P2p(*swarm.local_peer_id()));
                tracing::info!(%dialable, "listening (use this as a peer's bootstrap/relay address)");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_circuit_address_is_built_for_reservation() {
        // A relay multiaddr ending in /p2p/<PeerId> → reserve a circuit on it by
        // appending /p2p-circuit. This is the address the node listens on to
        // become reachable behind NAT (the network-independence fix). Use a real
        // generated PeerId so the multiaddr round-trips.
        let relay_peer = identity::Keypair::generate_ed25519().public().to_peer_id();
        let relay: Multiaddr = format!("/ip4/203.0.113.7/udp/4001/quic-v1/p2p/{relay_peer}")
            .parse()
            .unwrap();
        assert_eq!(peer_id_of(&relay), Some(relay_peer));
        let circuit = relay.clone().with(Protocol::P2pCircuit);
        // The reservation address keeps the relay + adds the circuit hop.
        assert!(circuit.to_string().ends_with("/p2p-circuit"));
        assert_eq!(peer_id_of(&circuit), Some(relay_peer));
        // A peer reaches us at <circuit>/p2p/<our PeerId> — no IP of ours, no DNS.
        let me: Multiaddr = format!("{circuit}/p2p/{relay_peer}").parse().unwrap();
        assert!(me.to_string().contains("/p2p-circuit/"));
    }

    #[test]
    fn bootstrap_addr_without_peer_id_is_rejected() {
        let no_id: Multiaddr = "/ip4/10.0.0.1/tcp/4001".parse().unwrap();
        assert_eq!(peer_id_of(&no_id), None);
    }
}
