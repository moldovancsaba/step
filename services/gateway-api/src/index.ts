/**
 * Production wiring for the gateway: real validator HTTP transport, viem
 * relayer to the internal testnet (ADR-006), evidence storage via
 * proof-storage service.
 *
 * Env (see .env.example): STEP_RPC_URL, STEP_CHAIN_ID, STEP_DEPLOYMENTS_FILE,
 * RELAYER_PRIVATE_KEY, GATEWAY_NONCE_SECRET, VALIDATOR_URLS,
 * PROOF_STORAGE_URL, STEP_PROTOCOL_PARAMS, GATEWAY_PORT.
 */
import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseProtocolParams, type Address, type Claim, type Hex } from "@step/shared-types";
import {
  MiningClaimVerifierAbi,
  ValidatorRegistryAbi,
  TriangleMiningStateAbi,
  FoundationTreasuryAbi,
  ProofRegistryAbi,
  RewardPoolAbi,
  TrinityTokenAbi,
  SafetyRegistryAbi,
  StepAccessAbi,
} from "@step/shared-types/abis";

// finaliseNaturalClaim/Sponsored call into sub-contracts; a revert there carries
// that contract's error selector, which MiningClaimVerifierAbi alone can't
// decode (viem then reports an opaque undecodable selector). Merge every
// contract's error fragments so simulate reverts always decode to the real
// error name.
const FINALISE_ABI = [
  ...MiningClaimVerifierAbi,
  ...[
    TriangleMiningStateAbi,
    FoundationTreasuryAbi,
    ProofRegistryAbi,
    RewardPoolAbi,
    TrinityTokenAbi,
    SafetyRegistryAbi,
    StepAccessAbi,
  ]
    .flat()
    .filter((f) => (f as { type?: string }).type === "error"),
] as const;
import { createApp, type GatewayDeps } from "./app.js";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

const params = parseProtocolParams(
  JSON.parse(readFileSync(env("STEP_PROTOCOL_PARAMS"), "utf8")),
);
const deployments = JSON.parse(readFileSync(env("STEP_DEPLOYMENTS_FILE"), "utf8"));
const verifierAddress = deployments.MiningClaimVerifier as Address;
const validatorRegistryAddress = deployments.ValidatorRegistry as Address;

const chain = defineChain({
  id: params.chainId,
  name: "step-internal",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env("STEP_RPC_URL")] } },
});
const publicClient = createPublicClient({ chain, transport: http() });
const relayer = privateKeyToAccount(env("RELAYER_PRIVATE_KEY") as Hex);
const walletClient = createWalletClient({ chain, transport: http(), account: relayer });

async function submitFinalise(
  functionName: "finaliseNaturalClaim" | "finaliseSponsoredClaim",
  args: readonly unknown[],
): Promise<Hex> {
  // simulate first: surfaces revert reasons without burning gas.
  const { request } = await publicClient.simulateContract({
    address: verifierAddress,
    abi: FINALISE_ABI,
    functionName,
    args: args as never,
    account: relayer,
  });
  const txHash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`tx ${txHash} reverted`);
  return txHash;
}

const deps: GatewayDeps = {
  nonceSecret: env("GATEWAY_NONCE_SECRET"),
  nonceTtlSeconds: params.nonceTtlSeconds,
  quorumThresholdWeight: BigInt(params.quorumThresholdWeight),
  validatorUrls: env("VALIDATOR_URLS").split(",").map((s) => s.trim()),

  async validate(url: string, claim: Claim) {
    const resp = await fetch(`${url}/v1/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ claim }),
    });
    if (!resp.ok) throw new Error(`validator ${url}: HTTP ${resp.status}`);
    return resp.json() as Promise<import("@step/shared-types").ValidateResponse>;
  },

  async weightOf(validator: Address) {
    return publicClient.readContract({
      address: validatorRegistryAddress,
      abi: ValidatorRegistryAbi,
      functionName: "activeWeight",
      args: [validator],
    }) as Promise<bigint>;
  },

  async submitNatural(a) {
    // finaliseNaturalClaim(claimHash, triangleId, meshLevel, miner, proofCidHash,
    // sigs) — the contract derives triangleIdHash from triangleId, so it is NOT
    // a parameter.
    return submitFinalise("finaliseNaturalClaim", [
      a.claimHash,
      a.triangleId,
      a.meshLevel,
      a.miner,
      a.proofCidHash,
      a.sortedApprovals.map((v) => ({ validator: v.validator, signature: v.signature })),
    ]);
  },

  async submitSponsored(a) {
    return submitFinalise("finaliseSponsoredClaim", [
      a.claimHash,
      a.triangleIdHash,
      a.campaignId,
      a.miner,
      a.proofCidHash,
      a.sortedApprovals.map((v) => ({ validator: v.validator, signature: v.signature })),
    ]);
  },

  async storeEvidence(bundle) {
    const url = process.env.PROOF_STORAGE_URL;
    if (url) {
      const resp = await fetch(`${url}/v1/bundles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bundle),
      });
      if (!resp.ok) throw new Error(`proof-storage: HTTP ${resp.status}`);
      const { cid } = (await resp.json()) as { cid: string };
      return keccak256(new TextEncoder().encode(cid));
    }
    // Explicit degraded mode for local development without the storage
    // service: the on-chain commitment is still real (hash of the bundle),
    // but the bundle is not persisted. Logged loudly; never for pilot.
    console.warn("PROOF_STORAGE_URL unset: evidence bundle NOT persisted (dev only)");
    return keccak256(new TextEncoder().encode(JSON.stringify(bundle)));
  },

  randomHex: () => randomBytes(8).toString("hex"),
  nowUnix: () => Math.floor(Date.now() / 1000),
  corsOrigins: process.env.STEP_CORS_ORIGINS
    ? process.env.STEP_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined,
  meshUrl: process.env.MESH_API_URL,
};

const { app } = createApp(deps);
const port = Number(process.env.GATEWAY_PORT ?? 8080);
console.log(`gateway-api listening on :${port} (verifier ${verifierAddress})`);
serve({ fetch: app.fetch, port });
