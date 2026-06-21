/**
 * fleet-api HTTP surface (#45): live fleet view + alerts + Prometheus metrics for
 * the trust-center federation. Read-only; consumed by the GDS Fleet console (#46).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DirectoryNode, FleetView, NodeProbe } from "./fleet.js";
import { buildFleetView } from "./fleet.js";
import { RateLimiter } from "./ratelimit.js";
import type { Heartbeat } from "./heartbeat.js";
import { classifyState, HeartbeatStore, verifyHeartbeat } from "./heartbeat.js";
import { deriveAlerts, type NodeStatus } from "./alerts.js";

export interface FleetDeps {
  /** Current federation nodes (from the node directory). */
  listNodes(): DirectoryNode[];
  /** Probe a single node: reachability, version, on-chain weight, target. */
  probe(node: DirectoryNode): Promise<NodeProbe>;
  quorumThreshold: bigint;
  corsOrigins?: string[];
  /** Signed-heartbeat intake (#56). When omitted, the endpoint is disabled. */
  heartbeats?: {
    store: HeartbeatStore;
    /** lowercased addresses allowed to heartbeat (the registered validators) */
    registered(): Set<string>;
    /** server clock in epoch ms (injectable for tests) */
    now(): number;
    /** a heartbeat older than this (ms) marks the node `dark`. Default 90s. */
    staleThresholdMs?: number;
    /** Abuse controls for public exposure (#66). Absent ⇒ off (trusted LAN). */
    ipPerMin?: number;
    nodePerMin?: number;
    maxBodyBytes?: number;
    /** ms to cache the registered-set snapshot (avoids rebuilding it per request). */
    registeredCacheTtlMs?: number;
  };
}

export function createApp(deps: FleetDeps) {
  const app = new Hono();
  if (deps.corsOrigins?.length) {
    app.use("*", cors({ origin: deps.corsOrigins, allowMethods: ["GET", "OPTIONS"] }));
  }

  async function view(): Promise<FleetView> {
    const nodes = deps.listNodes();
    const probes: Record<string, NodeProbe> = {};
    await Promise.all(
      nodes.map(async (n) => {
        try {
          probes[n.address.toLowerCase()] = await deps.probe(n);
        } catch {
          probes[n.address.toLowerCase()] = { reachable: false, onChainWeight: 0n };
        }
      }),
    );
    return buildFleetView(nodes, probes, deps.quorumThreshold);
  }

  app.get("/healthz", (c) => c.text("ok"));

  // Signed heartbeat intake (#56): hub-independent supervision signal. The hub
  // verifies the node's signature against its REGISTERED on-chain address (no
  // spoofing) and stamps its own receive time (the staleness clock).
  if (deps.heartbeats) {
    const hb = deps.heartbeats;
    // #66: cheap abuse controls BEFORE the expensive ECDSA recovery.
    const ipHb = hb.ipPerMin ? new RateLimiter(hb.ipPerMin, hb.ipPerMin / 60) : null;
    const nodeHb = hb.nodePerMin ? new RateLimiter(hb.nodePerMin, hb.nodePerMin / 60) : null;
    const maxBody = hb.maxBodyBytes ?? 4096; // a heartbeat is tiny
    const regTtl = hb.registeredCacheTtlMs ?? 5_000;
    let regCache: { set: Set<string>; expiresAt: number } | null = null;
    const registeredCached = (): Set<string> => {
      const t = hb.now();
      if (!regCache || regCache.expiresAt <= t) regCache = { set: hb.registered(), expiresAt: t + regTtl };
      return regCache.set;
    };
    const ipOf = (c: { req: { header(n: string): string | undefined } }) =>
      c.req.header("cf-connecting-ip") || (c.req.header("x-forwarded-for") || "").split(",")[0]?.trim() || "unknown";

    app.post("/v1/fleet/heartbeat", async (c) => {
      const len = Number(c.req.header("content-length") ?? "0");
      if (len > maxBody) return c.json({ error: "body too large" }, 413);
      if (ipHb) {
        const g = ipHb.take(ipOf(c), hb.now());
        if (!g.allowed) return c.json({ error: "rate limited", retry_after_s: g.retryAfterS }, 429);
      }
      const raw = await c.req.text();
      if (raw.length > maxBody) return c.json({ error: "body too large" }, 413); // guard if no content-length
      let body: Heartbeat;
      try {
        body = JSON.parse(raw) as Heartbeat;
      } catch {
        return c.json({ error: "bad json" }, 400);
      }
      // Per-claimed-node bucket (cheap; the claimed `node` is only a limiter key —
      // storage still requires signature verification below).
      if (nodeHb && typeof body?.node === "string") {
        const g = nodeHb.take(body.node.toLowerCase(), hb.now());
        if (!g.allowed) return c.json({ error: "rate limited", retry_after_s: g.retryAfterS }, 429);
      }
      const node = await verifyHeartbeat(body, registeredCached());
      if (!node) return c.json({ error: "unverified heartbeat" }, 401);
      hb.store.upsert(node, body, hb.now());
      return c.json({ ok: true, node });
    });

    // Four-state heartbeat view (#56): up | degraded | suspended | dark, with
    // deduped alerts derived from those states. On-chain weight (from probe) is
    // authoritative for `suspended`; staleness uses the hub's receive time.
    app.get("/v1/fleet/heartbeats", async (c) => {
      const stale = hb.staleThresholdMs ?? 90_000;
      const now = hb.now();
      const nodes = deps.listNodes();
      const weights: Record<string, bigint> = {};
      await Promise.all(
        nodes.map(async (n) => {
          try {
            weights[n.address.toLowerCase()] = (await deps.probe(n)).onChainWeight;
          } catch {
            weights[n.address.toLowerCase()] = 0n;
          }
        }),
      );
      // Drift is detected against the on-chain target by the main /v1/fleet view;
      // heartbeats carry only the running version, so no targetVersion here.
      const rows = nodes.map((n) => {
        const rec = hb.store.get(n.address);
        const weight = weights[n.address.toLowerCase()] ?? 0n;
        const state = classifyState(rec, weight, now, stale);
        const status: NodeStatus = { name: n.name, state, version: rec?.hb.version };
        const view = {
          name: n.name,
          address: n.address,
          location: n.location,
          state,
          last_seen: rec?.receivedAtMs ?? null,
          on_chain_weight: weight.toString(),
          degraded: rec?.hb.degraded,
          version: rec?.hb.version,
        };
        return { status, view };
      });
      const alerts = deriveAlerts(rows.map((r) => r.status), true);
      return c.json({ nodes: rows.map((r) => r.view), alerts });
    });
  }

  app.get("/v1/fleet", async (c) => c.json(await view()));

  app.get("/v1/fleet/alerts", async (c) => {
    const v = await view();
    return c.json({ alerts: v.alerts, quorumReachable: v.quorumReachable });
  });

  app.get("/metrics", async (c) => {
    const v = await view();
    const lines = [
      "# HELP step_fleet_active_weight Total on-chain active validator weight",
      "# TYPE step_fleet_active_weight gauge",
      `step_fleet_active_weight ${v.totalActiveWeight}`,
      "# HELP step_fleet_quorum_reachable 1 if active weight >= threshold",
      "# TYPE step_fleet_quorum_reachable gauge",
      `step_fleet_quorum_reachable ${v.quorumReachable ? 1 : 0}`,
      "# HELP step_fleet_node_in_quorum 1 if the node currently counts in quorum",
      "# TYPE step_fleet_node_in_quorum gauge",
      ...v.nodes.map(
        (n) => `step_fleet_node_in_quorum{node="${n.name}"} ${n.inQuorum ? 1 : 0}`,
      ),
      "# HELP step_fleet_alerts Active fleet alerts",
      "# TYPE step_fleet_alerts gauge",
      `step_fleet_alerts ${v.alerts.length}`,
    ];
    return c.text(lines.join("\n") + "\n");
  });

  return { app };
}
