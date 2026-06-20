import { describe, expect, it } from "vitest";
import { AlertGate, deriveAlerts, type FleetAlert, type NodeStatus } from "../src/alerts.js";

describe("deriveAlerts", () => {
  const n = (over: Partial<NodeStatus>): NodeStatus => ({ name: "x", state: "up", ...over });

  it("dark ⇒ critical missed-heartbeat", () => {
    const a = deriveAlerts([n({ name: "chappie", state: "dark" })], true);
    expect(a).toEqual([
      { node: "chappie", kind: "missed-heartbeat", severity: "critical", message: expect.any(String) },
    ]);
  });
  it("suspended ⇒ critical quarantine", () => {
    expect(deriveAlerts([n({ state: "suspended" })], true)[0]?.kind).toBe("quarantine");
  });
  it("degraded does NOT alert on its own (expected, transient)", () => {
    expect(deriveAlerts([n({ state: "degraded" })], true)).toHaveLength(0);
  });
  it("version drift on a live node ⇒ warning", () => {
    const a = deriveAlerts([n({ version: "1.0.0", targetVersion: "1.1.0" })], true);
    expect(a[0]).toMatchObject({ kind: "version-drift", severity: "warning" });
  });
  it("no drift alert for a dark node (its version is moot)", () => {
    const a = deriveAlerts([n({ state: "dark", version: "1.0.0", targetVersion: "1.1.0" })], true);
    expect(a.every((x) => x.kind !== "version-drift")).toBe(true);
  });
  it("below quorum ⇒ critical fleet alert", () => {
    const a = deriveAlerts([], false);
    expect(a).toEqual([{ node: "(fleet)", kind: "below-quorum", severity: "critical", message: expect.any(String) }]);
  });
});

describe("AlertGate", () => {
  function gate(cooldownMs: number) {
    const fired: FleetAlert[] = [];
    const g = new AlertGate((a) => fired.push(a), cooldownMs);
    return { g, fired };
  }
  const alert = (over: Partial<FleetAlert> = {}): FleetAlert => ({
    node: "chappie", kind: "missed-heartbeat", severity: "critical", message: "m", ...over,
  });

  it("fires once, then suppresses within the cooldown", () => {
    const { g, fired } = gate(1000);
    expect(g.process([alert()], 0)).toHaveLength(1);
    expect(g.process([alert()], 500)).toHaveLength(0); // within cooldown
    expect(fired).toHaveLength(1);
  });
  it("re-fires after the cooldown elapses", () => {
    const { g } = gate(1000);
    g.process([alert()], 0);
    expect(g.process([alert()], 1000)).toHaveLength(1);
  });
  it("re-fires immediately when an alert clears then recurs", () => {
    const { g } = gate(10_000);
    g.process([alert()], 0);
    g.process([], 100); // cleared
    expect(g.process([alert()], 200)).toHaveLength(1); // recurrence fires at once
  });
  it("dedups distinct kinds independently", () => {
    const { g, fired } = gate(1000);
    g.process([alert({ kind: "missed-heartbeat" }), alert({ kind: "quarantine" })], 0);
    expect(fired).toHaveLength(2);
    expect(g.process([alert({ kind: "missed-heartbeat" }), alert({ kind: "quarantine" })], 500)).toHaveLength(0);
  });
});
