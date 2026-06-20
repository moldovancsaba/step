#!/usr/bin/env node
/**
 * `onboard` (#53) — add ANY future trust center with one command, third-party-free
 * and location-agnostic. Composes the M9 pieces:
 *   1. register the node on-chain (join --no-launch)        → the trust grant
 *   2. transport: LAN/mDNS (default) or self-hosted WireGuard (wg-gen)
 *   3. build the boot-persistent AGENT bundle (bundle-agent)
 *   4. print the delivery + the single on-node command
 *
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
const transport = args.transport ?? "lan";
if (!["lan", "wireguard"].includes(transport)) die("--transport must be lan|wireguard");
const port = Number(args.port ?? 9104);
const advertise = args.advertise ?? `${args.name}.local`;
const weight = args.weight ?? "50";
const type = args.type ?? "Infrastructure";

if (transport === "wireguard" && !args["hub-endpoint"]) {
  die("--hub-endpoint <host:port> required for --transport wireguard (the hub's public/LAN WG endpoint)");
}

// 1. Register on-chain (idempotent: join reuses the saved key + skips re-register).
log(`1/4 registering "${args.name}" on-chain (weight ${weight}, ${type})…`);
run([
  join(ROOT, "scripts/node/join.mjs"),
  "--name", args.name, "--port", String(port), "--weight", String(weight),
  "--type", type, "--no-launch", "--url", `http://${advertise}:${port}`,
]);

// 2. Transport: derive the hub host the bundle will point at.
let hubHost;
if (transport === "wireguard") {
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
if (transport === "wireguard") {
  log("");
  log(`  # WireGuard (both sides): install the node config (.runtime/wg/${args.name}.conf)`);
  log(`  #   on ${args.name}, and append .runtime/wg/hub-${args.name}.peer to the hub's wg0.conf`);
}
log("");
log(`Verify on the hub:  node scripts/node/list.mjs   (${args.name} flips DOWN → up)`);

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

void cap; // reserved for future capture-based steps
