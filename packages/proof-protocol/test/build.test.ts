import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverClaimSigner } from "@step/shared-types";
import { buildUnsignedClaim, hashOfClaim, signClaim } from "../src/index.js";

const account = privateKeyToAccount(
  "0x4242424242424242424242424242424242424242424242424242424242424242",
);

describe("claim building", () => {
  it("builds, signs, and the signature recovers to the wallet", async () => {
    const unsigned = buildUnsignedClaim({
      wallet: account.address,
      triangleId: "STEP-21-F00-12203302320201311132",
      meshLevel: 21,
      latitude: 47.4979,
      longitude: 19.0402,
      horizontalAccuracyM: 5,
      nonce: "abc:2000000000:cafe0123.00112233445566778899aabbccddeeff",
      timestampUtc: "2026-06-12T10:00:00Z",
    });
    const claim = await signClaim(unsigned, account);
    expect((await recoverClaimSigner(claim)).toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
    // Hash is over the unsigned canonical message and is stable.
    expect(hashOfClaim(unsigned)).toBe(hashOfClaim({ ...unsigned }));
  });

  it("sponsored claims embed campaign and QR proof", () => {
    const unsigned = buildUnsignedClaim({
      wallet: account.address,
      triangleId: "STEP-21-F00-1",
      meshLevel: 21,
      latitude: 1,
      longitude: 2,
      horizontalAccuracyM: 5,
      nonce: "n".repeat(20),
      campaignId: "0x" + "55".repeat(32),
      merchantQrPayload: "stepqr1:poi_1:123:abcd",
    });
    expect(unsigned.campaign_id).toBeDefined();
    expect(unsigned.merchant_proof?.kind).toBe("qr");
    // Campaign id participates in the signed message (binding).
    const without = buildUnsignedClaim({
      wallet: account.address,
      triangleId: "STEP-21-F00-1",
      meshLevel: 21,
      latitude: 1,
      longitude: 2,
      horizontalAccuracyM: 5,
      nonce: "n".repeat(20),
    });
    expect(hashOfClaim(unsigned)).not.toBe(hashOfClaim(without));
  });
});
