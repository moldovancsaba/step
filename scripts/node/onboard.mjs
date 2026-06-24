#!/usr/bin/env node
/**
 * `onboard` (#53) — add ANY future trust center with one command, third-party-free
 * and location-agnostic. Composes the M9 pieces:
 *   1. register the node on-chain (join --no-launch)        → the trust grant
 *   2. transport: PEER (libp2p relay+DHT, default) / LAN-mDNS / self-hosted WireGuard
 *   3. build the boot-persistent AGENT bundle (bundle-agent)
 *   4. print the delivery + the single on-node command
 *
 * PEER is the network-independent default: the node is addressed by its PeerId
 * over a relay circuit + the DHT, so it joins from ANY network (home NAT, cellular,
 * another continent) with no LAN, no DNS, no public IP. Point it at a relay's
 * dialable peer address (printed by a node run with GOSSIP_RELAY_SERVER=1):
 *
 *   node scripts/node/onboard.mjs --name chappie \
 *     --relay /ip4/<relay-ip>/udp/4001/quic-v1/p2p/<relay-PeerId>
 *
 * LAN/WireGuard remain as a same-network fast-path / explicit tunnel:
 *   node scripts/node/onboard.mjs --name vienna --transport lan --advertise vienna.local
 *   node scripts/node/onboard.mjs --name budapest --transport wireguard \
 *        --advertise budapest --hub-endpoint tribecca.example:51820
 *
 * Idempotent: re-running reuses the node's saved identity.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = join(ROOT, ".runtime");
const PATH_EXT = `${process.env.HOME}/.cargo/bin:${process.env.HOME}/.foundry/bin:${process.env.PATH}`;
const die = (m) => { console.error(`[onboard] ${m}`); process.exit(1); };
const log = (m) => process.stdout.write(`[onboard] ${m}\n`);
const run = (args) => execFileSync("node", args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, PATH: PATH_EXT } });

const args = (() => {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith("--") ? v[++i] : "true";
  return a;
})();
if (!args.name) die("--name <node> required");
// Peer is the network-independent default. --relay implies peer.
const transport = args.transport ?? (args.relay ? "peer" : "peer");
if (!["peer", "lan", "wireguard"].includes(transport)) die("--transport must be peer|lan|wireguard");
const port = Number(args.port ?? 9104);
// In peer mode the node is addressed by PeerId, not a host — advertise is only a
// human label and the on-chain URL is the co-located loopback (peers reach the
// validator via its gossip node over the mesh, not via this URL).
const advertise = args.advertise ?? (transport === "peer" ? args.name : `${args.name}.local`);
const weight = args.weight ?? "50";
const type = args.type ?? "Infrastructure";

if (transport === "wireguard" && !args["hub-endpoint"]) {
  die("--hub-endpoint <host:port> required for --transport wireguard (the hub's public/LAN WG endpoint)");
}
if (transport === "peer" && !args.relay && !args["hub-host"]) {
  die("peer transport needs --relay <relay peer multiaddr> (cross-NAT reach) or --hub-host <chain-rpc-host>");
}
if (transport === "peer" && !args.relay) {
  log("note: no --relay given; the node joins via mDNS on the LAN + any GOSSIP_BOOTSTRAP seeds.");
  log("      To be reachable across NATs, pass --relay <relay peer multiaddr>.");
}

// 1. Register on-chain (idempotent: join reuses the saved key + skips re-register).
// In peer mode the registry URL is the co-located loopback — cross-node reach is
// over the mesh (PeerId), not this URL — so no resolvable host is baked on-chain.
const onchainUrl = transport === "peer" ? `http://127.0.0.1:${port}` : `http://${advertise}:${port}`;
log(`1/4 registering "${args.name}" on-chain (weight ${weight}, ${type})…`);
run([
  join(ROOT, "scripts/node/join.mjs"),
  "--name", args.name, "--port", String(port), "--weight", String(weight),
  "--type", type, "--no-launch", "--url", onchainUrl,
]);

// 2. Transport: derive the hub host (for the node-agent's chain RPC) + the gossip
// peer wiring (for the consensus mesh).
let hubHost;
if (transport === "peer") {
  // Network-independent: the consensus mesh joins via the relay circuit + DHT by
  // PeerId. The chain RPC the node-agent reads is taken from the relay's host
  // (the relay is co-located with the hub chain) unless --hub-host overrides.
  hubHost = args["hub-host"] ?? (args.relay ? relayHost(args.relay) : null);
  if (!hubHost) die("peer transport needs --hub-host <chain-rpc-host> or --relay with an ip4/ip6 multiaddr");
  log(`2/4 transport PEER — gossip joins by PeerId over relay/DHT; chain RPC host ${hubHost}`);
} else if (transport === "wireguard") {
  log(`2/4 generating self-hosted WireGuard config for "${args.name}"…`);
  run([join(ROOT, "scripts/net/wg-gen.mjs"), "--peer", args.name, "--hub-endpoint", args["hub-endpoint"]]);
  const hub = JSON.parse(readFileSync(join(RUNTIME, "wg", "hub.json"), "utf8"));
  hubHost = hub.tunnelIp; // the node reaches the hub at its WG tunnel IP
} else {
  // LAN: mDNS name or a reserved IP for the hub (no third party).
  hubHost = args["hub-host"] ?? detectLanHost();
  log(`2/4 transport LAN — hub host ${hubHost}`);
}

// 3. Build the boot-persistent agent bundle.
log(`3/4 building the agent bundle (boot-persistent, third-party-free)…`);
run([
  join(ROOT, "scripts/node/bundle-agent.mjs"),
  "--name", args.name, "--hub-host", hubHost, "--advertise-host", advertise, "--port", String(port),
]);

// 4. Delivery + the single on-node command.
const tgz = join(RUNTIME, `agent-${args.name}.tgz`);
log("");
log(`✓ "${args.name}" onboarded (registered + bundle built). Deliver + run:`);
log("");
log(`  # deliver the bundle to ${args.name} (pick one):`);
log(`  scp "${tgz}" <user>@${advertise}:~/`);
if (existsSync(`/Applications/Tailscale.app`)) log(`  # (or any LAN file share — the bundle is self-contained)`);
log("");
log(`  # then ON ${args.name}, one command:`);
log(`  tar -xzf agent-${args.name}.tgz && cd agent-bundle-${args.name} \\`);
log(`    && xattr -dr com.apple.quarantine step-node-agent 2>/dev/null; \\`);
log(`    ./provision-secrets.sh && ./install-service.sh`);
if (transport === "peer") {
  log("");
  log(`  # then run the consensus mesh peer-natively (network-independent — joins by`);
  log(`  # PeerId over the relay circuit + DHT, reachable behind any NAT, no DNS):`);
  log(`  GOSSIP_RELAYS=${args.relay ?? "<relay peer multiaddr>"} \\`);
  log(`  GOSSIP_BOOTSTRAP=${args.bootstrap ?? args.relay ?? "<seed peer multiaddr>"} \\`);
  log(`  VALIDATOR_PRIVATE_KEY=<node key> VERIFIER_CONTRACT_ADDRESS=<verifier> \\`);
  log(`  STEP_CHAIN_ID=262144 STEP_QUORUM_THRESHOLD=<threshold> \\`);
  log(`    step-gossip-node    # logs "requested relay reservation" + its dialable /p2p address`);
}
if (transport === "wireguard") {
  log("");
  log(`  # WireGuard (both sides): install the node config (.runtime/wg/${args.name}.conf)`);
  log(`  #   on ${args.name}, and append .runtime/wg/hub-${args.name}.peer to the hub's wg0.conf`);
}
log("");
log(`Verify on the hub:  node scripts/node/list.mjs   (${args.name} flips DOWN → up)`);

// Pull the ip4/ip6 literal out of a relay multiaddr for the chain-RPC host. The
// gossip layer never needs this (it dials by PeerId); it's only so the node-agent
// can read the chain from the same machine that runs the relay.
function relayHost(multiaddr) {
  const m = /\/ip[46]\/([^/]+)\//.exec(multiaddr);
  return m ? m[1] : null;
}

function detectLanHost() {
  // Prefer the hub's mDNS name; fall back to a LAN IPv4.
  try {
    const name = execFileSync("scutil", ["--get", "LocalHostName"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (name) return `${name}.local`;
  } catch { /* not macOS */ }
  for (const iface of ["en0", "en1"]) {
    try {
      const ip = execFileSync("ipconfig", ["getifaddr", iface], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch { /* next */ }
  }
  return "tribecca.local";
}
