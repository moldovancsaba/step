/**
 * Cross-language conformance: replay the Rust-generated vector
 * (packages/schemas/cross-language-vector.v1.json). Any drift between the
 * TypeScript and Rust implementations of the canonical message, claim hash,
 * nonce format, miner signature, or EIP-712 vote digest fails here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import {
  canonicalClaimMessage,
  claimHash,
  makeNonce,
  personalDigest,
  recoverClaimSigner,
  triangleIdHash,
  voteDigest,
  parseProtocolParams,
  type Claim,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const vector = JSON.parse(
  readFileSync(join(here, "../../schemas/cross-language-vector.v1.json"), "utf8"),
);
const claim: Claim = vector.claim_json;

describe("cross-language conformance (Rust vector)", () => {
  it("canonical message matches byte-for-byte", () => {
    expect(canonicalClaimMessage(claim)).toBe(vector.canonical_message);
  });

  it("claim hash matches", () => {
    expect(claimHash(canonicalClaimMessage(claim))).toBe(vector.claim_hash);
  });

  it("triangle id hash matches", () => {
    expect(triangleIdHash(claim.triangle_id)).toBe(vector.triangle_id_hash);
  });

  it("nonce format matches the Rust reference implementation", () => {
    // wallet inside the vector nonce payload: f39f00... with expiry 2000000000
    const wallet = "0xf39f000000000000000000000000000000000000" as const;
    expect(makeNonce(vector.nonce_secret, wallet, 2_000_000_000, "cafe0123")).toBe(
      vector.nonce,
    );
  });

  it("miner signature recovers to the vector wallet", async () => {
    expect((await recoverClaimSigner(claim)).toLowerCase()).toBe(
      vector.wallet.toLowerCase(),
    );
  });

  it("re-signing with the vector key reproduces a valid signature", async () => {
    const account = privateKeyToAccount(vector.miner_private_key);
    expect(account.address.toLowerCase()).toBe(vector.wallet.toLowerCase());
    const sig = await account.sign({
      hash: personalDigest(canonicalClaimMessage(claim)),
    });
    const reSigned: Claim = { ...claim, signature: sig };
    expect((await recoverClaimSigner(reSigned)).toLowerCase()).toBe(
      vector.wallet.toLowerCase(),
    );
  });

  it("EIP-712 vote digest matches the Rust implementation", () => {
    const digest = voteDigest(
      31337n,
      "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
      vector.claim_hash,
      vector.triangle_id_hash,
      vector.wallet,
      true,
    );
    expect(digest).toBe(
      vector["vote_digest_chain31337_contract_0x610178dA211FEF7D417bC0e6FeD39F05609AD788"],
    );
  });
});

describe("protocol parameter registry", () => {
  it("loads the alpha registry without hardcoded fallbacks", () => {
    const registry = JSON.parse(
      readFileSync(join(here, "../../../config/protocol-params.alpha.json"), "utf8"),
    );
    const p = parseProtocolParams(registry);
    expect(p.mineableLevels).toEqual([21]);
    expect(p.collectorSlots).toBe(27);
    expect(p.chainId).toBe(31337);
    // Missing keys must throw, never default silently.
    expect(() => parseProtocolParams({})).toThrow(/registry missing/);
  });
});
