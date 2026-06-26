/**
 * fleet-api wiring (#45). Reads the federation directory for the node list, probes
 * each node's validator (/healthz + /v1/node/info) and on-chain activeWeight, and
 * serves the aggregated fleet view + alerts.
 *
 * Env: NODE_DIRECTORY_FILE, STEP_RPC_URL, STEP_DEPLOYMENTS_FILE (or
 * VALIDATOR_REGISTRY), STEP_QUORUM_THRESHOLD (default 101), FLEET_PORT (8099),
 * STEP_CORS_ORIGINS.
 */
import { serve } from "@hono/node-server";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { createApp } from "./app.js";
import type { DirectoryNode, NodeProbe } from "./fleet.js";
import { HeartbeatStore } from "./heartbeat.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const TRUST_CENTER_STATUS = ["none", "pending", "active", "suspended", "revoked"] as const;
const TRUST_CENTER_REGISTRY_ABI = [
  { type: "function", name: "nodeOwner", stateMutability: "view", inputs: [{ name: "node", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "rewardRecipient", stateMutability: "view", inputs: [{ name: "node", type: "address" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "nodeStatus", stateMutability: "view", inputs: [{ name: "node", type: "address" }], outputs: [{ name: "", type: "uint8" }] },
] as const;

const ACTIVE_WEIGHT_ABI = [
  {
    type: "function",
    name: "activeWeight",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${key}`);
  return v;
}

const directoryFile = env("NODE_DIRECTORY_FILE");
const rpcUrl = env("STEP_RPC_URL");
const chainId = Number(env("STEP_CHAIN_ID", "31337"));
const quorumThreshold = BigInt(env("STEP_QUORUM_THRESHOLD", "101"));

let registry = process.env.VALIDATOR_REGISTRY as Address | undefined;
let trustCenterRegistry = process.env.TRUST_CENTER_REGISTRY as Address | undefined;
const deploymentsFile = process.env.STEP_DEPLOYMENTS_FILE;
if (deploymentsFile && existsSync(deploymentsFile)) {
  const deployments = JSON.parse(readFileSync(deploymentsFile, "utf8"));
  registry = (registry ?? deployments.ValidatorRegistry) as Address;
  trustCenterRegistry = (trustCenterRegistry ?? deployments.TrustCenterRegistry) as Address | undefined;
}
if (!registry) throw new Error("could not resolve ValidatorRegistry address");

const chain = defineChain({
  id: chainId,
  name: "step-internal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http() });

function listNodes(): DirectoryNode[] {
  if (!existsSync(directoryFile)) return [];
  try {
    const dir = JSON.parse(readFileSync(directoryFile, "utf8")) as { nodes?: DirectoryNode[] };
    return dir.nodes ?? [];
  } catch {
    return [];
  }
}

async function probe(node: DirectoryNode): Promise<NodeProbe> {
  const onChainWeight = (await client.readContract({
    address: registry!,
    abi: ACTIVE_WEIGHT_ABI,
    functionName: "activeWeight",
    args: [node.address as Address],
  })) as bigint;

  const trustCenter = trustCenterRegistry
    ? await trustCenterInfo(node.address as Address).catch(() => ({}))
    : {};

  if ((node.transport ?? "http") === "peer") {
    return {
      reachable: onChainWeight > 0n,
      version: "peer-native",
      onChainWeight,
      ...trustCenter,
    };
  }

  let reachable = false;
  let version: string | undefined;
  try {
    const ctrl = AbortSignal.timeout(2500);
    const info = await fetch(`${node.url}/v1/node/info`, { signal: ctrl });
    if (info.ok) {
      reachable = true;
      const body = (await info.json()) as { software_version?: string };
      version = body.software_version;
    }
  } catch {
    reachable = false;
  }
  return { reachable, version, onChainWeight, ...trustCenter };
}

async function trustCenterInfo(addr: Address) {
  if (!trustCenterRegistry) return {};
  const [owner, recipient, statusRaw] = await Promise.all([
    client.readContract({ address: trustCenterRegistry, abi: TRUST_CENTER_REGISTRY_ABI, functionName: "nodeOwner", args: [addr] }) as Promise<Address>,
    client.readContract({ address: trustCenterRegistry, abi: TRUST_CENTER_REGISTRY_ABI, functionName: "rewardRecipient", args: [addr] }) as Promise<Address>,
    client.readContract({ address: trustCenterRegistry, abi: TRUST_CENTER_REGISTRY_ABI, functionName: "nodeStatus", args: [addr] }) as Promise<number>,
  ]);
  return {
    ownerWallet: owner.toLowerCase() !== ZERO_ADDRESS ? owner.toLowerCase() : undefined,
    rewardRecipient: recipient.toLowerCase() !== ZERO_ADDRESS ? recipient.toLowerCase() : undefined,
    trustCenterStatus: TRUST_CENTER_STATUS[Number(statusRaw)] ?? "none",
  };
}

const corsOrigins = process.env.STEP_CORS_ORIGINS
  ? process.env.STEP_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

// Signed-heartbeat intake (#56): only the directory's registered validator
// addresses may heartbeat, and only for their own (signature-recovered) address.
const heartbeatStore = new HeartbeatStore();
const heartbeats = {
  store: heartbeatStore,
  registered: () => new Set(listNodes().map((n) => n.address.toLowerCase())),
  now: () => Date.now(),
  // #66 abuse controls (config; default permissive for a trusted LAN).
  ipPerMin: Number(process.env.HEARTBEAT_IP_PER_MIN ?? 120),
  nodePerMin: Number(process.env.HEARTBEAT_NODE_PER_MIN ?? 6),
  maxBodyBytes: Number(process.env.HEARTBEAT_MAX_BODY_BYTES ?? 4096),
};

const peerDirectory = {
  now: () => Date.now(),
  ttlMs: Number(process.env.PEER_RECORD_TTL_SECONDS ?? 90_000),
  maxBodyBytes: Number(process.env.PEER_ANNOUNCEMENT_MAX_BODY_BYTES ?? 8192),
};

const { app } = createApp({ listNodes, probe, quorumThreshold, corsOrigins, heartbeats, peerDirectory });
const port = Number(process.env.FLEET_PORT ?? 8099);
console.log(`fleet-api listening on :${port}`);
serve({ fetch: app.fetch, port });
