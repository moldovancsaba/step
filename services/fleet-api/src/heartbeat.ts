/**
 * Signed fleet heartbeats (#56) — the pure, testable core.
 *
 * Supervision must not depend on the hub being the sole observer. Each agent
 * signs a periodic heartbeat with its node key and POSTs it to the hub; the hub
 * verifies the signature against the node's REGISTERED on-chain address (so a
 * heartbeat can't be spoofed for a node you don't control), stamps its own
 * receive time, and stores it with bounded retention.
 *
 * From the last heartbeat + on-chain weight we derive a four-state view that
 * distinguishes the cases a pull-only probe conflates:
 *   - up         — recent heartbeat, healthy, in quorum
 *   - degraded   — recent heartbeat, but the node reported `degraded` (e.g. its
 *                  own hub/chain link is flapping, #51) or child health down
 *   - suspended  — on-chain weight 0 (tamper hold / UnderReview, #36) — authoritative
 *   - dark       — no heartbeat within the stale threshold (missed-heartbeat)
 *
 * Chain remains authoritative for quorum: `suspended` is decided by on-chain
 * weight, never by the node's self-report.
 */
import { recoverMessageAddress } from "viem";

export type Health = "up" | "down";
export type Integrity = "ok" | "quarantined";

/** What a node signs and sends. `sig` covers the canonical form of all other fields. */
export interface Heartbeat {
  node: `0x${string}`;
  version: string;
  health: Health;
  integrity: Integrity;
  /** present when the node is running but its own hub/chain link is degraded (#51) */
  degraded?: string;
  /** node-local ISO timestamp (informational; staleness uses server receive-time) */
  ts: string;
  /** signature over `heartbeatMessage(hb)` by the node key */
  sig: `0x${string}`;
}

export type NodeState = "up" | "degraded" | "suspended" | "dark";

/** A stored heartbeat plus the hub's own receive time (the staleness clock). */
export interface HeartbeatRecord {
  hb: Heartbeat;
  /** server receive time in epoch ms — staleness is measured against THIS, not `ts` */
  receivedAtMs: number;
}

/**
 * Canonical signing message. Deterministic field order, `degraded` omitted when
 * absent (so present-but-empty and absent never collide), no `sig`. Both the
 * agent (signer) and the hub (verifier) must derive the message identically.
 */
export function heartbeatMessage(hb: Pick<Heartbeat, "node" | "version" | "health" | "integrity" | "degraded" | "ts">): string {
  const canonical: Record<string, string> = {
    node: hb.node.toLowerCase(),
    version: hb.version,
    health: hb.health,
    integrity: hb.integrity,
    ts: hb.ts,
  };
  if (hb.degraded !== undefined && hb.degraded !== "") canonical.degraded = hb.degraded;
  return JSON.stringify(canonical);
}

/**
 * Verify a heartbeat: the recovered signer must equal `hb.node` AND be in the set
 * of registered validator addresses. Returns the lowercased node address on success,
 * or `null` on any failure (bad sig, address mismatch, unregistered, malformed).
 */
export async function verifyHeartbeat(
  hb: Heartbeat,
  registered: Set<string>,
): Promise<string | null> {
  const claimed = hb.node.toLowerCase();
  if (!registered.has(claimed)) return null;
  let recovered: string;
  try {
    recovered = (
      await recoverMessageAddress({ message: heartbeatMessage(hb), signature: hb.sig })
    ).toLowerCase();
  } catch {
    return null; // malformed signature
  }
  return recovered === claimed ? claimed : null;
}

/** Bounded, in-memory heartbeat store keyed by lowercased node address. */
export class HeartbeatStore {
  private readonly latest = new Map<string, HeartbeatRecord>();
  /** retention is implicit: one record per node (the latest). */
  upsert(node: string, hb: Heartbeat, receivedAtMs: number): void {
    const key = node.toLowerCase();
    const prev = this.latest.get(key);
    // monotonic guard: ignore a stale/replayed heartbeat older than what we hold
    if (prev && receivedAtMs < prev.receivedAtMs) return;
    this.latest.set(key, { hb, receivedAtMs });
  }
  get(node: string): HeartbeatRecord | undefined {
    return this.latest.get(node.toLowerCase());
  }
  entries(): [string, HeartbeatRecord][] {
    return [...this.latest.entries()];
  }
}

/**
 * Derive the four-state view. On-chain weight is authoritative for `suspended`;
 * a missing/old heartbeat is `dark`; otherwise the node's self-report decides
 * up vs degraded.
 */
export function classifyState(
  record: HeartbeatRecord | undefined,
  onChainWeight: bigint,
  nowMs: number,
  staleThresholdMs: number,
): NodeState {
  // Chain is authoritative: weight 0 ⇒ suspended even if it's still heartbeating.
  if (onChainWeight <= 0n) return "suspended";
  if (!record || nowMs - record.receivedAtMs > staleThresholdMs) return "dark";
  if (record.hb.integrity === "quarantined") return "suspended";
  if (record.hb.health !== "up" || record.hb.degraded) return "degraded";
  return "up";
}
