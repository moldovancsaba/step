import { describe, expect, it } from "vitest";
import { buildFleetView, type DirectoryNode, type NodeProbe } from "../src/fleet.js";

const nodes: DirectoryNode[] = [
  { name: "validator-0", address: "0xaaa", url: "http://a", location: "hub" },
  { name: "chappie", address: "0xBBB", url: "http://b", location: "remote" },
];

function probes(p: Partial<Record<string, NodeProbe>>): Record<string, NodeProbe> {
  return {
    "0xaaa": { reachable: true, version: "1.0.0", onChainWeight: 50n },
    "0xbbb": { reachable: true, version: "1.0.0", onChainWeight: 50n },
    ...p,
  } as Record<string, NodeProbe>;
}

describe("buildFleetView", () => {
  it("healthy fleet reaches quorum with no alerts", () => {
    const v = buildFleetView(nodes, probes({}), 100n);
    expect(v.totalActiveWeight).toBe("100");
    expect(v.quorumReachable).toBe(true);
    expect(v.alerts).toHaveLength(0);
    expect(v.nodes.every((n) => n.inQuorum)).toBe(true);
  });

  it("an unreachable node raises a critical alert and may drop quorum", () => {
    const v = buildFleetView(nodes, probes({ "0xbbb": { reachable: false, onChainWeight: 0n } }), 100n);
    const a = v.alerts.find((x) => x.kind === "unreachable");
    expect(a?.severity).toBe("critical");
    expect(v.totalActiveWeight).toBe("50");
    expect(v.quorumReachable).toBe(false);
    expect(v.alerts.some((x) => x.kind === "below-quorum")).toBe(true);
  });

  it("a suspended (tamper-held) node is surfaced via on-chain weight 0", () => {
    // reachable but on-chain weight 0 ⇒ UnderReview (e.g. tamper auto-suspend, #36)
    const v = buildFleetView(
      nodes,
      probes({ "0xbbb": { reachable: true, version: "1.0.0", onChainWeight: 0n } }),
      100n,
    );
    const a = v.alerts.find((x) => x.kind === "suspended");
    expect(a?.severity).toBe("critical");
    expect(a?.message).toMatch(/tamper/);
  });

  it("version drift on a healthy node is a warning, not critical", () => {
    const v = buildFleetView(
      nodes,
      probes({ "0xbbb": { reachable: true, version: "1.0.0", onChainWeight: 50n, targetVersion: "1.1.0" } }),
      100n,
    );
    const a = v.alerts.find((x) => x.kind === "version-drift");
    expect(a?.severity).toBe("warning");
    expect(v.quorumReachable).toBe(true);
  });

  it("addresses are matched case-insensitively", () => {
    // node 0xBBB in directory, probe keyed lowercase — must still match
    const v = buildFleetView(nodes, probes({}), 100n);
    expect(v.nodes.find((n) => n.name === "chappie")?.inQuorum).toBe(true);
  });
});
