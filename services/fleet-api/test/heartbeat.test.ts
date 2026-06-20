import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  classifyState,
  heartbeatMessage,
  HeartbeatStore,
  verifyHeartbeat,
  type Heartbeat,
  type HeartbeatRecord,
} from "../src/heartbeat.js";

// deterministic test key (public anvil account #0 — not a secret) // gitleaks:allow
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(PK);

async function signed(overrides: Partial<Heartbeat> = {}): Promise<Heartbeat> {
  const base = {
    node: account.address.toLowerCase() as `0x${string}`,
    version: "1.0.0",
    health: "up" as const,
    integrity: "ok" as const,
    ts: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
  const sig = await account.signMessage({ message: heartbeatMessage(base) });
  return { ...base, sig };
}

describe("verifyHeartbeat", () => {
  it("accepts a correctly signed heartbeat from a registered node", async () => {
    const hb = await signed();
    const registered = new Set([account.address.toLowerCase()]);
    expect(await verifyHeartbeat(hb, registered)).toBe(account.address.toLowerCase());
  });

  it("rejects an unregistered node even with a valid signature", async () => {
    const hb = await signed();
    expect(await verifyHeartbeat(hb, new Set())).toBeNull();
  });

  it("rejects a tampered field (signature no longer matches)", async () => {
    const hb = await signed();
    const tampered: Heartbeat = { ...hb, version: "9.9.9" };
    const registered = new Set([account.address.toLowerCase()]);
    expect(await verifyHeartbeat(tampered, registered)).toBeNull();
  });

  it("rejects a spoofed node field (claims another address)", async () => {
    const hb = await signed({ node: "0x000000000000000000000000000000000000dead" });
    const registered = new Set(["0x000000000000000000000000000000000000dead"]);
    expect(await verifyHeartbeat(hb, registered)).toBeNull();
  });

  it("rejects a malformed signature without throwing", async () => {
    const hb = await signed();
    const registered = new Set([account.address.toLowerCase()]);
    expect(await verifyHeartbeat({ ...hb, sig: "0xnotasig" }, registered)).toBeNull();
  });

  it("canonical message omits absent degraded but includes present", () => {
    const m1 = heartbeatMessage({ node: "0xAa", version: "1", health: "up", integrity: "ok", ts: "t" });
    const m2 = heartbeatMessage({ node: "0xAa", version: "1", health: "up", integrity: "ok", degraded: "", ts: "t" });
    expect(m1).toBe(m2); // empty degraded === absent
    const m3 = heartbeatMessage({ node: "0xAa", version: "1", health: "up", integrity: "ok", degraded: "x", ts: "t" });
    expect(m3).not.toBe(m1);
    expect(m1).not.toContain("degraded");
  });
});

describe("HeartbeatStore", () => {
  const hb = { node: "0xAbC", version: "1", health: "up", integrity: "ok", ts: "t", sig: "0x" } as Heartbeat;
  it("keeps the latest by receive time and is case-insensitive", () => {
    const s = new HeartbeatStore();
    s.upsert("0xAbC", hb, 100);
    s.upsert("0xabc", { ...hb, version: "2" }, 200);
    expect(s.get("0xABC")?.hb.version).toBe("2");
  });
  it("ignores an out-of-order (replayed) older heartbeat", () => {
    const s = new HeartbeatStore();
    s.upsert("0xAbC", { ...hb, version: "2" }, 200);
    s.upsert("0xAbC", { ...hb, version: "1" }, 100); // older receive time
    expect(s.get("0xAbC")?.hb.version).toBe("2");
  });
});

describe("classifyState", () => {
  const rec = (over: Partial<Heartbeat>, receivedAtMs: number): HeartbeatRecord => ({
    hb: { node: "0xa", version: "1", health: "up", integrity: "ok", ts: "t", sig: "0x", ...over },
    receivedAtMs,
  });
  const NOW = 10_000;
  const STALE = 1_000;

  it("up when recent, healthy, in quorum", () => {
    expect(classifyState(rec({}, NOW), 50n, NOW, STALE)).toBe("up");
  });
  it("suspended when on-chain weight 0 (authoritative, even if heartbeating)", () => {
    expect(classifyState(rec({}, NOW), 0n, NOW, STALE)).toBe("suspended");
  });
  it("suspended when integrity quarantined", () => {
    expect(classifyState(rec({ integrity: "quarantined" }, NOW), 50n, NOW, STALE)).toBe("suspended");
  });
  it("dark when no heartbeat", () => {
    expect(classifyState(undefined, 50n, NOW, STALE)).toBe("dark");
  });
  it("dark when heartbeat is older than the stale threshold", () => {
    expect(classifyState(rec({}, NOW - STALE - 1), 50n, NOW, STALE)).toBe("dark");
  });
  it("degraded when the node self-reports degraded", () => {
    expect(classifyState(rec({ degraded: "hub unreachable" }, NOW), 50n, NOW, STALE)).toBe("degraded");
  });
  it("degraded when child health is down", () => {
    expect(classifyState(rec({ health: "down" }, NOW), 50n, NOW, STALE)).toBe("degraded");
  });
});
