/**
 * @step/shared-types — cross-service protocol types and canonical crypto.
 *
 * The canonical claim message, claim hash, nonce format, and EIP-712 vote
 * digest implemented here are bit-compatible with the Rust reference
 * (packages/validation-rules) — proven by replaying
 * packages/schemas/cross-language-vector.v1.json in the test suite.
 */

import {
  encodeAbiParameters,
  keccak256,
  recoverAddress,
  stringToBytes,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";

// ---------------------------------------------------------------------------
// Claim types (mirror packages/schemas/step.proof.location.v1.json)
// ---------------------------------------------------------------------------

export type IntegrityMode = "attested" | "dev-unattested" | "failed";

export interface MerchantProof {
  kind: "qr";
  payload: string;
}

export interface Claim {
  schema_version: "step.proof.location.v1";
  wallet_address: Address;
  triangle_id: string;
  mesh_level: number;
  latitude: number;
  longitude: number;
  horizontal_accuracy_m: number;
  altitude_m?: number;
  vertical_accuracy_m?: number;
  timestamp_utc: string;
  nonce: string;
  integrity_mode: IntegrityMode;
  app_attestation?: string;
  device_integrity?: string;
  previous_claim_hash?: Hex;
  campaign_id?: string;
  merchant_proof?: MerchantProof;
  signature: Hex;
}

export type ClaimStatus =
  | "submitted"
  | "validating"
  | "accepted"
  | "finalised"
  | "rejected";

export interface SignedVote {
  validator: Address;
  signature: Hex;
  claim_hash: Hex;
  triangle_id_hash: Hex;
  miner: Address;
  approve: boolean;
}

export interface ValidatorVerdict {
  approve: boolean;
  reject_reasons: string[];
  fraud: { score: number; signals: { signal: string; value: number; detail: string }[] };
  boundary: string;
}

export interface ValidateResponse {
  verdict: ValidatorVerdict;
  vote: SignedVote;
  validated_at: string;
}

export interface TriangleInfo {
  triangle_id: string;
  triangle_id_hash: Hex;
  level: number;
  vertices: { lat: number; lon: number }[];
  centroid: { lat: number; lon: number };
  area_m2: number;
  min_side_m: number;
  parent: string | null;
  neighbours: string[];
  mesh_spec_version: string;
}

// ---------------------------------------------------------------------------
// Canonical claim message (STEP-CLAIM-V1) — must match Rust exactly
// ---------------------------------------------------------------------------

/** Fixed-decimal formatter matching Rust's `{:.N}` (round-half-even is not
 * used by Rust here; `{:.7}` rounds half away from zero — toFixed matches for
 * the value ranges in use and conformance is pinned by the vector test). */
function fixed(n: number, places: number): string {
  return n.toFixed(places);
}

export function canonicalClaimMessage(c: Omit<Claim, "signature">): string {
  return (
    `STEP-CLAIM-V1\n` +
    `wallet=${c.wallet_address.toLowerCase()}\n` +
    `triangle=${c.triangle_id}\n` +
    `level=${c.mesh_level}\n` +
    `lat=${fixed(c.latitude, 7)}\n` +
    `lon=${fixed(c.longitude, 7)}\n` +
    `acc=${fixed(c.horizontal_accuracy_m, 2)}\n` +
    `ts=${c.timestamp_utc}\n` +
    `nonce=${c.nonce}\n` +
    `integrity=${c.integrity_mode}\n` +
    `campaign=${c.campaign_id ?? "-"}\n` +
    `prev=${c.previous_claim_hash ?? "-"}\n`
  );
}

export function claimHash(canonicalMessage: string): Hex {
  return keccak256(stringToBytes(canonicalMessage));
}

export function triangleIdHash(triangleId: string): Hex {
  return keccak256(stringToBytes(triangleId));
}

/** EIP-191 personal-message digest (what the miner wallet signs). */
export function personalDigest(message: string): Hex {
  const bytes = stringToBytes(message);
  const prefix = stringToBytes(`\x19Ethereum Signed Message:\n${bytes.length}`);
  const joined = new Uint8Array(prefix.length + bytes.length);
  joined.set(prefix);
  joined.set(bytes, prefix.length);
  return keccak256(joined);
}

export async function recoverClaimSigner(claim: Claim): Promise<Address> {
  const digest = personalDigest(canonicalClaimMessage(claim));
  return recoverAddress({ hash: digest, signature: claim.signature });
}

// ---------------------------------------------------------------------------
// EIP-712 validator vote digest — must match MiningClaimVerifier.sol
// ---------------------------------------------------------------------------

const DOMAIN_TYPEHASH = keccak256(
  stringToBytes(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);
const VOTE_TYPEHASH = keccak256(
  stringToBytes(
    "StepValidatorVote(bytes32 claimHash,bytes32 triangleId,address miner,bool approve)",
  ),
);

export function voteDigest(
  chainId: bigint,
  verifyingContract: Address,
  claimHash_: Hex,
  triangleIdHash_: Hex,
  miner: Address,
  approve: boolean,
): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [DOMAIN_TYPEHASH, keccak256(stringToBytes("StepMiningClaim")), keccak256(stringToBytes("1")), chainId, verifyingContract],
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "bool" }],
      [VOTE_TYPEHASH, claimHash_, triangleIdHash_, miner, approve],
    ),
  );
  const joined = new Uint8Array(2 + 32 + 32);
  joined.set([0x19, 0x01]);
  joined.set(toBytes(domainSeparator), 2);
  joined.set(toBytes(structHash), 34);
  return keccak256(joined);
}

// ---------------------------------------------------------------------------
// Gateway nonce (ADR-017) — issuance side of the Rust node's verifier
// ---------------------------------------------------------------------------

export function makeNonce(
  secret: string,
  wallet: Address,
  expiryUnix: number,
  randomHex: string,
): string {
  const payload = `${wallet.slice(2).toLowerCase()}:${expiryUnix}:${randomHex}`;
  const keyed = new Uint8Array(secret.length + payload.length);
  keyed.set(stringToBytes(secret));
  keyed.set(stringToBytes(payload), secret.length);
  const tag = keccak256(keyed);
  return `${payload}.${tag.slice(2, 34)}`; // first 16 bytes of the tag, hex
}

// ---------------------------------------------------------------------------
// Protocol parameter registry loader (ENG-001: parameters are never hardcoded)
// ---------------------------------------------------------------------------

export interface ProtocolParams {
  mineableLevels: number[];
  trinityPerStep: number;
  collectorSlots: number;
  baseRewardTrinity: number;
  twinBps: number;
  nonceTtlSeconds: number;
  claimTimestampWindowSeconds: number;
  quorumThresholdWeight: number;
  referencePriceEurPerStep: number;
  chainId: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseProtocolParams(registryJson: any): ProtocolParams {
  const v = (group: string, key: string) => {
    const entry = registryJson?.[group]?.[key];
    if (entry === undefined || entry.value === undefined) {
      throw new Error(`protocol parameter registry missing ${group}.${key}.value`);
    }
    return entry.value;
  };
  return {
    mineableLevels: v("mesh", "mineable_levels"),
    trinityPerStep: v("trinity", "trinity_per_step"),
    collectorSlots: v("mining", "collector_slots_per_triangle"),
    baseRewardTrinity: v("mining", "base_reward_trinity"),
    twinBps: v("treasury", "foundation_twin_bps"),
    nonceTtlSeconds: v("proof", "nonce_ttl_seconds"),
    claimTimestampWindowSeconds: v("proof", "claim_timestamp_window_seconds"),
    quorumThresholdWeight: v("validators", "quorum_threshold_weight"),
    referencePriceEurPerStep: v("campaigns", "reference_price_eur_per_step"),
    chainId: v("chain", "chain_id"),
  };
}

export { toHex };
export type { Address, Hex };
