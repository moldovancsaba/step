/**
 * Closed campaign-credit accounting — the ONLY exchange-path component allowed
 * in alpha (ADR-011, HARD §8.3 "Alpha: simulated price and closed campaign
 * credits"). There is NO market here: no user-to-user trades, no fiat, no
 * order book. The foundation grants credits to pilot merchants off-market;
 * credits convert to a Trinity budget figure at the declared reference price
 * for campaign accounting only.
 *
 * Every response carries the HARD §8.4 disclaimer verbatim. Phases 2–3
 * (KYC-gated marketplace, regulated exchange) are BLOCKED on legal review
 * (LEG-002) and intentionally absent from this codebase.
 */
import { Hono } from "hono";

export const REFERENCE_PRICE_DISCLAIMER =
  "Reference price for pilot campaign accounting only — not a market price, not a promise of value or investment return.";

export interface CreditLedgerEntry {
  kind: "grant" | "conversion";
  amount_credits: number;
  trinity_equivalent?: string;
  at: string;
  note?: string;
}

export interface ExchangeConfig {
  adminToken: string;
  /** EUR per STEP, from the protocol parameter registry (UNFROZEN). */
  referencePriceEurPerStep: number;
  trinityPerStep: number;
}

export function createApp(config: ExchangeConfig) {
  const app = new Hono();
  const balances = new Map<string, number>(); // merchant_id → credits (EUR-denominated)
  const ledgers = new Map<string, CreditLedgerEntry[]>();

  const ledger = (m: string) => {
    let l = ledgers.get(m);
    if (!l) {
      l = [];
      ledgers.set(m, l);
    }
    return l;
  };

  app.get("/healthz", (c) => c.text("ok"));

  /** Foundation grants pilot credits (off-market, ADR-011). */
  app.post("/v1/credits/grant", async (c) => {
    if (c.req.header("authorization") !== `Bearer ${config.adminToken}`) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = await c.req.json().catch(() => null);
    const merchant = body?.merchant_id as string | undefined;
    const amount = Number(body?.amount_credits);
    if (!merchant || !Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: "merchant_id and positive amount_credits required" }, 400);
    }
    balances.set(merchant, (balances.get(merchant) ?? 0) + amount);
    ledger(merchant).push({
      kind: "grant",
      amount_credits: amount,
      at: new Date().toISOString(),
      note: body?.note,
    });
    return c.json({
      merchant_id: merchant,
      balance_credits: balances.get(merchant),
      disclaimer: REFERENCE_PRICE_DISCLAIMER,
    });
  });

  app.get("/v1/credits/:merchant", (c) => {
    const merchant = c.req.param("merchant");
    return c.json({
      merchant_id: merchant,
      balance_credits: balances.get(merchant) ?? 0,
      ledger: ledger(merchant),
      reference_price_eur_per_step: config.referencePriceEurPerStep,
      disclaimer: REFERENCE_PRICE_DISCLAIMER,
    });
  });

  /** Convert credits → Trinity budget figure for a campaign (accounting only;
   *  the actual Trinity lock happens on-chain via RewardPool). */
  app.post("/v1/credits/convert", async (c) => {
    const body = await c.req.json().catch(() => null);
    const merchant = body?.merchant_id as string | undefined;
    const amount = Number(body?.amount_credits);
    if (!merchant || !Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: "merchant_id and positive amount_credits required" }, 400);
    }
    const balance = balances.get(merchant) ?? 0;
    if (amount > balance) {
      return c.json({ error: "insufficient credits", balance_credits: balance }, 409);
    }
    // credits are EUR-denominated; Trinity is indivisible → floor (PRD-004).
    const trinity = BigInt(
      Math.floor((amount / config.referencePriceEurPerStep) * config.trinityPerStep),
    );
    balances.set(merchant, balance - amount);
    ledger(merchant).push({
      kind: "conversion",
      amount_credits: amount,
      trinity_equivalent: trinity.toString(),
      at: new Date().toISOString(),
    });
    return c.json({
      merchant_id: merchant,
      trinity_budget: trinity.toString(),
      balance_credits: balances.get(merchant),
      disclaimer: REFERENCE_PRICE_DISCLAIMER,
    });
  });

  return app;
}
