import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/ratelimit.js";

describe("RateLimiter", () => {
  it("allows up to capacity then denies with a retry hint", () => {
    const r = new RateLimiter(3, 1); // 3 tokens, 1/s refill
    expect(r.take("a", 0).allowed).toBe(true);
    expect(r.take("a", 0).allowed).toBe(true);
    expect(r.take("a", 0).allowed).toBe(true);
    const denied = r.take("a", 0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterS).toBe(1);
  });

  it("rejects a non-finite, zero, or negative cost", () => {
    const r = new RateLimiter(3, 1);
    expect(() => r.take("a", 0, 0)).toThrow(/positive finite/);
    expect(() => r.take("a", 0, -1)).toThrow(/positive finite/);
    expect(() => r.take("a", 0, Number.NaN)).toThrow(/positive finite/);
    expect(() => r.take("a", 0, Number.POSITIVE_INFINITY)).toThrow(/positive finite/);
    expect(r.take("a", 0, 1).allowed).toBe(true);
  });

  it("refills over time", () => {
    const r = new RateLimiter(2, 1);
    r.take("a", 0);
    r.take("a", 0);
    expect(r.take("a", 0).allowed).toBe(false);
    expect(r.take("a", 1000).allowed).toBe(true); // 1s → 1 token back
  });

  it("is per-key", () => {
    const r = new RateLimiter(1, 1);
    expect(r.take("a", 0).allowed).toBe(true);
    expect(r.take("b", 0).allowed).toBe(true);
    expect(r.take("a", 0).allowed).toBe(false);
  });

  it("bounds its key set (no memory DoS)", () => {
    const r = new RateLimiter(1, 1, 2); // max 2 keys
    r.take("a", 0);
    r.take("b", 0);
    r.take("c", 0); // evicts "a"
    expect(r.take("a", 0).allowed).toBe(true); // "a" was evicted → fresh bucket
  });
});
