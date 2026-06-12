import { describe, expect, it } from "vitest";
import { createApp, REFERENCE_PRICE_DISCLAIMER } from "../src/app.js";

const TOKEN = "admin-token";
const app = () =>
  createApp({ adminToken: TOKEN, referencePriceEurPerStep: 1, trinityPerStep: 100_000_000 });

describe("closed campaign credits (ADR-011)", () => {
  it("grants require the foundation token", async () => {
    const a = app();
    const noAuth = await a.request("/v1/credits/grant", {
      method: "POST",
      body: JSON.stringify({ merchant_id: "mer_1", amount_credits: 100 }),
      headers: { "content-type": "application/json" },
    });
    expect(noAuth.status).toBe(403);
  });

  it("grant → balance → convert with floor-rounded indivisible Trinity", async () => {
    const a = app();
    await a.request("/v1/credits/grant", {
      method: "POST",
      body: JSON.stringify({ merchant_id: "mer_1", amount_credits: 100 }),
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    });
    const bal = (await (await a.request("/v1/credits/mer_1")).json()) as any;
    expect(bal.balance_credits).toBe(100);
    expect(bal.disclaimer).toBe(REFERENCE_PRICE_DISCLAIMER);

    const conv = (await (
      await a.request("/v1/credits/convert", {
        method: "POST",
        body: JSON.stringify({ merchant_id: "mer_1", amount_credits: 2.5 }),
        headers: { "content-type": "application/json" },
      })
    ).json()) as any;
    // 2.5 EUR at 1 EUR/STEP × 1e8 Trinity/STEP = 250,000,000 Trinity exactly.
    expect(conv.trinity_budget).toBe("250000000");
    expect(conv.balance_credits).toBe(97.5);
    expect(conv.disclaimer).toBe(REFERENCE_PRICE_DISCLAIMER);
  });

  it("cannot convert more than the balance", async () => {
    const a = app();
    const resp = await a.request("/v1/credits/convert", {
      method: "POST",
      body: JSON.stringify({ merchant_id: "mer_2", amount_credits: 10 }),
      headers: { "content-type": "application/json" },
    });
    expect(resp.status).toBe(409);
  });

  it("ledger records every movement", async () => {
    const a = app();
    await a.request("/v1/credits/grant", {
      method: "POST",
      body: JSON.stringify({ merchant_id: "mer_3", amount_credits: 50, note: "pilot" }),
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    });
    await a.request("/v1/credits/convert", {
      method: "POST",
      body: JSON.stringify({ merchant_id: "mer_3", amount_credits: 20 }),
      headers: { "content-type": "application/json" },
    });
    const bal = (await (await a.request("/v1/credits/mer_3")).json()) as any;
    expect(bal.ledger).toHaveLength(2);
    expect(bal.ledger[0].kind).toBe("grant");
    expect(bal.ledger[1].kind).toBe("conversion");
  });
});
