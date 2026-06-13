/**
 * @step/proof-protocol — claim construction and signing (POP-002, DEV §6.4).
 *
 * Used by the e2e harness and the web miner view; the iOS app implements the
 * identical canonical format natively (apps/ios/StepCore). The JSON Schemas in
 * packages/schemas remain the wire-format source of truth.
 */
import type { Account } from "viem";
import {
  canonicalClaimMessage,
  claimHash,
  personalDigest,
  type Address,
  type Claim,
  type Hex,
  type IntegrityMode,
} from "@step/shared-types";

export interface ClaimInput {
  wallet: Address;
  triangleId: string;
  meshLevel: number;
  latitude: number;
  longitude: number;
  horizontalAccuracyM: number;
  timestampUtc?: string;
  nonce: string;
  integrityMode?: IntegrityMode;
  campaignId?: string;
  merchantQrPayload?: string;
  previousClaimHash?: Hex;
}

export function buildUnsignedClaim(input: ClaimInput): Omit<Claim, "signature"> {
  return {
    schema_version: "step.proof.location.v1",
    wallet_address: input.wallet,
    triangle_id: input.triangleId,
    mesh_level: input.meshLevel,
    latitude: input.latitude,
    longitude: input.longitude,
    horizontal_accuracy_m: input.horizontalAccuracyM,
    timestamp_utc:
      input.timestampUtc ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    nonce: input.nonce,
    integrity_mode: input.integrityMode ?? "dev-unattested",
    ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
    ...(input.merchantQrPayload
      ? { merchant_proof: { kind: "qr" as const, payload: input.merchantQrPayload } }
      : {}),
    ...(input.previousClaimHash ? { previous_claim_hash: input.previousClaimHash } : {}),
  };
}

/** Sign with any viem account (local key in tests/e2e; injected wallet on web). */
export async function signClaim(
  unsigned: Omit<Claim, "signature">,
  account: Account,
): Promise<Claim> {
  if (!account.sign) throw new Error("account cannot sign digests");
  const signature = await account.sign({
    hash: personalDigest(canonicalClaimMessage(unsigned)),
  });
  return { ...unsigned, signature };
}

export function hashOfClaim(claim: Omit<Claim, "signature">): Hex {
  return claimHash(canonicalClaimMessage(claim));
}
