#!/usr/bin/env node
/**
 * `wg-gen` (#48) — generate a self-hosted WireGuard config for a trust center in
 * another location, so it reaches the hub over a tunnel WE control (no Tailscale,
 * no SaaS). Same-LAN nodes don't need this.
 *
 *   node scripts/net/wg-gen.mjs --peer vienna --peer-ip 10.50.0.2 \
 *        --hub-endpoint tribecca.example:51820
 *
 * Writes, under .runtime/wg/:
 *   <peer>.conf        the node's wg0.conf (give it to that machine)
 *   hub-<peer>.peer    the [Peer] block to APPEND to the hub's wg0.conf
 * Generates the node keypair locally (Curve25519 via Node X25519). The hub's
 * public key + tunnel IP are read from .runtime/wg/hub.json (created on first run).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wgKeypair, hubPeerBlock, peerConfig } from "./wg-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WG = join(ROOT, ".runtime", "wg");
const die = (m) => { console.error(`[wg-gen] ${m}`); process.exit(1); };
const log = (m) => process.stdout.write(`[wg-gen] ${m}\n`);

const args = (() => {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith("--")) a[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith("--") ? v[++i] : "true";
  return a;
})();
if (!args.peer) die("--peer <name> required");
if (!args["hub-endpoint"]) die("--hub-endpoint <host:port> required (the hub's public/LAN WireGuard endpoint)");

mkdirSync(WG, { recursive: true });

// Hub identity (its WG keypair + tunnel IP) — generated once, reused.
const hubFile = join(WG, "hub.json");
let hub;
if (existsSync(hubFile)) {
  hub = JSON.parse(readFileSync(hubFile, "utf8"));
} else {
  const kp = wgKeypair();
  hub = { tunnelIp: args["hub-ip"] ?? "10.50.0.1", publicKey: kp.publicKey, privateKey: kp.privateKey };
  writeFileSync(hubFile, JSON.stringify(hub, null, 2) + "\n", { mode: 0o600 });
  // also emit the hub's own [Interface] once
  writeFileSync(
    join(WG, "hub-wg0.conf"),
    [`[Interface]`, `PrivateKey = ${hub.privateKey}`, `Address = ${hub.tunnelIp}/24`, `ListenPort = ${(args["hub-endpoint"].split(":")[1] || "51820")}`, ``].join("\n"),
    { mode: 0o600 },
  );
  log(`generated hub WireGuard identity → ${hubFile} (+ hub-wg0.conf)`);
}

const peerIp = args["peer-ip"] ?? `10.50.0.${2 + Math.floor(Math.random() * 200)}`;
const kp = wgKeypair();

writeFileSync(
  join(WG, `${args.peer}.conf`),
  peerConfig({
    privateKey: kp.privateKey,
    address: peerIp,
    hubPublicKey: hub.publicKey,
    hubEndpoint: args["hub-endpoint"],
    hubTunnelIp: hub.tunnelIp,
  }),
  { mode: 0o600 },
);
writeFileSync(join(WG, `hub-${args.peer}.peer`), hubPeerBlock({ name: args.peer, publicKey: kp.publicKey, address: peerIp }));

log("");
log(`✓ WireGuard config for "${args.peer}"`);
log(`  node config:  .runtime/wg/${args.peer}.conf   (install on ${args.peer} as /etc/wireguard/wg0.conf or via the app)`);
log(`  hub peer:     .runtime/wg/hub-${args.peer}.peer  (append to the hub's wg0.conf, then 'wg syncconf')`);
log(`  node tunnel IP: ${peerIp}   hub tunnel IP: ${hub.tunnelIp}`);
log("");
log(`Then bundle the agent pointed at the hub's tunnel IP:`);
log(`  node scripts/node/bundle-agent.mjs --name ${args.peer} --hub-host ${hub.tunnelIp}`);
