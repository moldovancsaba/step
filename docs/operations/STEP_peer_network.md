# The peer network — network-independent, no LAN, no DNS

> How STEP nodes find and reach each other **anywhere** — home NAT, cellular,
> another continent — using the libp2p peer stack, not IP addresses or DNS. This
> is the default; LAN/mDNS is only a same-network fast-path.

## What makes it network-independent

Every node runs the full peer stack (`services/gossip-node`, #54):

- **Identity = PeerId**, derived from the validator's secp256k1 key. A node is
  addressed by *who it is*, never by *where it is*. No DNS, no static IP.
- **Kademlia DHT (server mode)** — decentralized discovery; nodes find each other
  through the routing table, seeded by a few bootstrap peers (like Bitcoin seeds).
- **Relay reservation + DCUtR** — the line that removes the LAN restriction: a
  NAT'd node `listen_on(<relay>/p2p-circuit)` to **reserve a circuit**, then
  advertises `<relay>/p2p-circuit/p2p/<self>` via identify→DHT. Any peer can now
  reach it through the relay, and **DCUtR hole-punches that into a direct
  connection**. Without the reservation, relay_client + DCUtR are inert and home
  nodes are unreachable — that was the gap.
- **QUIC + TCP** — QUIC (UDP) traverses NATs better; both are offered.
- **gossipsub** — claims/votes propagate peer-to-peer; quorum is decided on the
  mesh, with **no central gateway** in the claim→finalise path.

The only "infrastructure" is one or more **public relays** — themselves just
nodes run with `GOSSIP_RELAY_SERVER=1`, addressed by PeerId. No third-party
signaling server, no SaaS.

## Run a public relay (the network's anchor)

On any reachable machine (a VPS, or a home box with one UDP port forwarded):

```bash
GOSSIP_RELAY_SERVER=1 \
GOSSIP_LISTEN=/ip4/0.0.0.0/udp/4001/quic-v1 \
VALIDATOR_PRIVATE_KEY=<key> VERIFIER_CONTRACT_ADDRESS=<verifier> \
STEP_CHAIN_ID=262144 STEP_QUORUM_THRESHOLD=<threshold> \
  step-gossip-node
# It logs:  dialable=/ip4/<ip>/udp/4001/quic-v1/p2p/<RelayPeerId>
# Hand THAT string to joiners as --relay / GOSSIP_RELAYS. It is the only address
# anyone needs — no DNS name, and it works from any network.
```

A few relays in different places = no single point of failure. Any node can be a
relay; designate the stable ones.

## Join from anywhere (no LAN, no DNS)

```bash
node scripts/node/onboard.mjs --name chappie \
  --relay /ip4/<relay-ip>/udp/4001/quic-v1/p2p/<RelayPeerId>
```

That registers the on-chain trust grant and prints the peer-native mesh launch.
The joining node reserves a circuit on the relay, joins the DHT, and starts
gossiping — **regardless of the network it sits on**. Behind a home router on
cellular? Still reachable, via the relay until DCUtR upgrades to direct.

## How this maps to the north-star

- **No single hub** — relays are interchangeable and PeerId-addressed; the quorum
  decision is on the mesh, not at a gateway.
- **No DNS dependency** — addresses are PeerIds + IP literals of relays; if a
  relay dies, point at another. Nothing resolves a name.
- **Environment-independent** — the same join command works on a LAN, a phone on
  cellular, or a VPS. LAN/mDNS just makes co-located peers connect instantly.

LAN/WireGuard transports remain in `onboard.mjs` as an explicit same-network
fast-path, **not** the boundary. The boundary for going fully public is the
secret-key genesis ceremony (#58) + governed handover (#59) — see
`docs/operations/STEP_scaling_to_N_nodes.md` Phase 6.
