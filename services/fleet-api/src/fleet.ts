/**
 * Fleet aggregation + alerting (#45) — the pure, testable core.
 *
 * Combines three sources of truth per trust center and raises explicit alerts so
 * an operator can SEE that the fleet is OK (or not):
 *   1. the federation directory   — who the nodes are + where
 *   2. the node's live probe       — reachable? what version?
 *   3. the on-chain active weight   — does it still count in quorum?
 *
 * A node demoted by a tamper finding (#36) shows on-chain weight 0 → surfaced as a
 * high-severity alert here, so quarantine is visible without trusting the node's
 * own self-report. No silent degradation: a dark or suspended node always alerts.
 */

export interface DirectoryNode {
  name: string;
  address: string;
  url: string;
  /** Public HTTPS endpoint advertised to the edge router, if different from url. */
  publicUrl?: string;
  /** Optional libp2p/multiaddr for peer-native transport. */
  p2pAddress?: string;
  /** Services this node can publicly serve. */
  services?: string[];
  location?: string;
  /** peer-native nodes are reached through libp2p/gossip, not hub HTTP polling. */
  transport?: "http" | "peer" | string;
  /** declared weight from the directory (for drift display) */
  weight?: number;
}

export interface PeerRecord {
  schemaVersion?: "step.peer-record.v1";
  nodeAddress: string;
  publicUrl: string;
  p2pAddress?: string;
  services: string[];
  status: "active" | "degraded" | "suspended" | "revoked" | "stale";
  version?: string;
  chainId?: string;
  sequence?: number;
  lastSeen: string;
  expiresAt: string;
  source: "directory" | "announcement";
  signature?: `0x${string}`;
}

export interface NodeProbe {
  /** node answered its health/info probe */
  reachable: boolean;
  /** software version reported by the node, if reachable */
  version?: string;
  /** on-chain ValidatorRegistry.activeWeight (0 ⇒ not counting in quorum) */
  onChainWeight: bigint;
  /** target version the node should be running (from ReleaseRegistry), if known */
  targetVersion?: string;
  ownerWallet?: string;
  rewardRecipient?: string;
  trustCenterStatus?: "none" | "pending" | "active" | "suspended" | "revoked";
}

export type Severity = "critical" | "warning";

export interface Alert {
  node: string;
  severity: Severity;
  kind: "unreachable" | "suspended" | "version-drift" | "below-quorum";
  message: string;
}

export interface FleetNode {
  name: string;
  address: string;
  location?: string;
  url: string;
  transport?: string;
  p2pAddress?: string;
  reachable: boolean;
  version?: string;
  targetVersion?: string;
  onChainWeight: string;
  inQuorum: boolean;
  alert?: Alert;
  ownerWallet?: string;
  rewardRecipient?: string;
  trustCenterStatus?: "none" | "pending" | "active" | "suspended" | "revoked";
}

export interface FleetView {
  nodes: FleetNode[];
  totalActiveWeight: string;
  quorumThreshold: string;
  quorumReachable: boolean;
  alerts: Alert[];
}

export function buildPeerRecords(
  nodes: DirectoryNode[],
  probes: Record<string, NodeProbe>,
  nowMs: number,
  ttlMs: number,
): PeerRecord[] {
  const lastSeen = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  return nodes.flatMap((node) => {
    const publicUrl = node.publicUrl ?? node.url;
    if (!/^https:\/\//i.test(publicUrl)) return [];
    const probe = probes[node.address.toLowerCase()];
    if (!probe?.reachable || probe.onChainWeight <= 0n) return [];
    return [{
      nodeAddress: node.address.toLowerCase(),
      publicUrl,
      p2pAddress: node.p2pAddress,
      services: node.services?.length ? node.services : ["gateway", "mesh", "indexer", "fleet", "artifacts"],
      status: "active" as const,
      version: probe.version,
      sequence: nowMs,
      lastSeen,
      expiresAt,
      source: "directory" as const,
    }];
  });
}

/**
 * Build the fleet view. `driftGraceVersions` mirrors that a node may legitimately
 * lag the target briefly during an update — when the node is reachable, healthy,
 * and counting in quorum, a version mismatch is a low-noise warning, not critical.
 */
export function buildFleetView(
  nodes: DirectoryNode[],
  probes: Record<string, NodeProbe>,
  quorumThreshold: bigint,
): FleetView {
  const out: FleetNode[] = [];
  let totalActive = 0n;
  const alerts: Alert[] = [];

  for (const n of nodes) {
    const probe = probes[n.address.toLowerCase()] ?? { reachable: false, onChainWeight: 0n };
    const inQuorum = probe.onChainWeight > 0n;
    if (inQuorum) totalActive += probe.onChainWeight;

    let alert: Alert | undefined;
    if (!probe.reachable) {
      alert = {
        node: n.name,
        severity: "critical",
        kind: "unreachable",
        message: `${n.name} is not responding`,
      };
    } else if (!inQuorum) {
      // reachable but on-chain weight 0 ⇒ UnderReview/Suspended (e.g. tamper hold)
      alert = {
        node: n.name,
        severity: "critical",
        kind: "suspended",
        message: `${n.name} is suspended from quorum (on-chain weight 0 — possible tamper hold)`,
      };
    } else if (
      probe.targetVersion &&
      probe.version &&
      probe.targetVersion !== probe.version
    ) {
      alert = {
        node: n.name,
        severity: "warning",
        kind: "version-drift",
        message: `${n.name} runs ${probe.version}, target is ${probe.targetVersion}`,
      };
    }
    if (alert) alerts.push(alert);

    out.push({
      name: n.name,
      address: n.address,
      location: n.location,
      url: n.transport === "peer" ? n.p2pAddress ?? n.url : n.url,
      transport: n.transport,
      p2pAddress: n.p2pAddress,
      reachable: probe.reachable,
      version: probe.version,
      targetVersion: probe.targetVersion,
      onChainWeight: probe.onChainWeight.toString(),
      inQuorum,
      alert,
      ownerWallet: probe.ownerWallet,
      rewardRecipient: probe.rewardRecipient,
      trustCenterStatus: probe.trustCenterStatus,
    });
  }

  const quorumReachable = totalActive >= quorumThreshold;
  if (!quorumReachable) {
    alerts.push({
      node: "(fleet)",
      severity: "critical",
      kind: "below-quorum",
      message: `fleet active weight ${totalActive} is below the quorum threshold ${quorumThreshold}`,
    });
  }

  return {
    nodes: out,
    totalActiveWeight: totalActive.toString(),
    quorumThreshold: quorumThreshold.toString(),
    quorumReachable,
    alerts,
  };
}
