import { describe, expect, it } from "vitest";
import { scanWindows } from "../src/scan.js";

describe("scanWindows (bounded block pagination)", () => {
  it("returns a single window when the gap fits in maxRange", () => {
    expect(scanWindows(1n, 3n, 5000n)).toEqual([[1n, 3n]]);
  });

  it("splits a large gap into provider-safe windows", () => {
    // 15k blocks at 5k/window → 3 bounded getLogs calls, none exceeding the cap.
    expect(scanWindows(1n, 15000n, 5000n)).toEqual([
      [1n, 5000n],
      [5001n, 10000n],
      [10001n, 15000n],
    ]);
  });

  it("returns nothing when already caught up (from > head)", () => {
    expect(scanWindows(11n, 10n, 5000n)).toEqual([]);
  });

  it("rejects a non-positive maxRange", () => {
    expect(() => scanWindows(1n, 10n, 0n)).toThrow(/positive/);
  });
});
