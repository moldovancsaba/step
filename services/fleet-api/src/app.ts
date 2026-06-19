/**
 * fleet-api HTTP surface (#45): live fleet view + alerts + Prometheus metrics for
 * the trust-center federation. Read-only; consumed by the GDS Fleet console (#46).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { DirectoryNode, FleetView, NodeProbe } from "./fleet.js";
import { buildFleetView } from "./fleet.js";

export interface FleetDeps {
  /** Current federation nodes (from the node directory). */
  listNodes(): DirectoryNode[];
  /** Probe a single node: reachability, version, on-chain weight, target. */
  probe(node: DirectoryNode): Promise<NodeProbe>;
  quorumThreshold: bigint;
  corsOrigins?: string[];
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
