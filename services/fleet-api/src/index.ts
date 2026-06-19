/**
 * fleet-api wiring (#45). Reads the federation directory for the node list, probes
 * each node's validator (/healthz + /v1/node/info) and on-chain activeWeight, and
 * serves the aggregated fleet view + alerts.
 *
 * Env: NODE_DIRECTORY_FILE, STEP_RPC_URL, STEP_DEPLOYMENTS_FILE (or
 * VALIDATOR_REGISTRY), STEP_QUORUM_THRESHOLD (default 100), FLEET_PORT (8099),
 * STEP_CORS_ORIGINS.
 */
import { serve } from "@hono/node-server";
import { readFileSync, existsSync } from "node:fs";
import { createPublicClient, defineChain, http, type Address } from "viem";
import { createApp } from "./app.js";
import type { DirectoryNode, NodeProbe } from "./fleet.js";

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
const quorumThreshold = BigInt(env("STEP_QUORUM_THRESHOLD", "100"));

let registry = process.env.VALIDATOR_REGISTRY as Address | undefined;
const deploymentsFile = process.env.STEP_DEPLOYMENTS_FILE;
if (!registry && deploymentsFile && existsSync(deploymentsFile)) {
  registry = JSON.parse(readFileSync(deploymentsFile, "utf8")).ValidatorRegistry as Address;
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
  return { reachable, version, onChainWeight };
}

const corsOrigins = process.env.STEP_CORS_ORIGINS
  ? process.env.STEP_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

const { app } = createApp({ listNodes, probe, quorumThreshold, corsOrigins });
const port = Number(process.env.FLEET_PORT ?? 8099);
console.log(`fleet-api listening on :${port}`);
serve({ fetch: app.fetch, port });
