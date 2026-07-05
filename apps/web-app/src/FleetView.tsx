/**
 * Fleet & Release console (#46) — operator view of the trust-center federation:
 * per-node health, version, on-chain quorum weight, and active alerts. Built only
 * with @sovereignsquad/gds primitives (MetricCard, EmptyState) + Mantine (the GDS
 * substrate); no parallel visual system. Fully accessible: semantic table,
 * keyboard-operable, status conveyed by text+icon (never colour alone), and a
 * live region announcing alerts.
 */
import { useCallback, useEffect, useState } from "react";
import { MetricCard, EmptyState, GdsIcons } from "@sovereignsquad/gds";
import { Badge, Button, Group, Loader, Stack, Table, Text, Title } from "@mantine/core";

type Alert = {
  node: string;
  severity: "critical" | "warning";
  kind: string;
  message: string;
};
type FleetNode = {
  name: string;
  address: string;
  location?: string;
  reachable: boolean;
  version?: string;
  targetVersion?: string;
  onChainWeight: string;
  inQuorum: boolean;
};
type Fleet = {
  nodes: FleetNode[];
  totalActiveWeight: string;
  quorumThreshold: string;
  quorumReachable: boolean;
  alerts: Alert[];
};

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const FLEET_URL = env.VITE_FLEET_URL;

/** Health/quorum status as an accessible chip: icon + text, not colour alone. */
function StatusChip({ node }: { node: FleetNode }) {
  if (!node.reachable) {
    return (
      <Badge
        color="red"
        leftSection={<GdsIcons.Danger size="0.875rem" aria-hidden />}
        aria-label={`${node.name} status: down`}
      >
        Down
      </Badge>
    );
  }
  if (!node.inQuorum) {
    return (
      <Badge
        color="orange"
        leftSection={<GdsIcons.Info size="0.875rem" aria-hidden />}
        aria-label={`${node.name} status: suspended from quorum`}
      >
        Suspended
      </Badge>
    );
  }
  return (
    <Badge
      color="teal"
      leftSection={<GdsIcons.Success size="0.875rem" aria-hidden />}
      aria-label={`${node.name} status: healthy and in quorum`}
    >
      Healthy
    </Badge>
  );
}

export function FleetView() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!FLEET_URL) {
      setError("Fleet API not configured for this build (set VITE_FLEET_URL).");
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const r = await fetch(`${FLEET_URL}/v1/fleet`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFleet((await r.json()) as Fleet);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load fleet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !fleet)
    return (
      <Group justify="center" py="xl">
        <Loader aria-label="Loading fleet status" />
      </Group>
    );

  if (error && !fleet)
    return (
      <EmptyState
        title="Fleet status unavailable"
        description={error}
        action={
          <Button leftSection={<GdsIcons.Refresh size="1rem" aria-hidden />} onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );

  if (!fleet || fleet.nodes.length === 0)
    return (
      <EmptyState
        title="No trust-center nodes yet"
        description="Add a node with scripts/node/join.mjs; it will appear here once it is registered and running."
      />
    );

  return (
    <Stack gap="md">
      <Group grow>
        <MetricCard
          label="Active weight"
          value={fleet.totalActiveWeight}
          description={`quorum threshold ${fleet.quorumThreshold}`}
          trend={
            fleet.quorumReachable
              ? { label: "quorum reachable", tone: "positive" }
              : { label: "below quorum", tone: "negative" }
          }
        />
        <MetricCard label="Nodes" value={String(fleet.nodes.length)} description="trust centers" />
        <MetricCard
          label="Alerts"
          value={String(fleet.alerts.length)}
          description="active"
          trend={
            fleet.alerts.length === 0
              ? { label: "all clear", tone: "positive" }
              : { label: "attention", tone: "negative" }
          }
        />
      </Group>

      {/* Live region so screen readers announce alerts as they change. */}
      <div aria-live="polite" aria-atomic="true">
        {fleet.alerts.length > 0 && (
          <Stack gap="xs">
            <Title order={3} size="h5">
              Active alerts
            </Title>
            {fleet.alerts.map((a, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                {a.severity === "critical" ? (
                  <GdsIcons.Danger size="1rem" aria-hidden color="var(--mantine-color-red-6)" />
                ) : (
                  <GdsIcons.Info size="1rem" aria-hidden color="var(--mantine-color-orange-6)" />
                )}
                <Text size="sm">
                  <Text span fw={600}>
                    {a.severity === "critical" ? "Critical" : "Warning"}:
                  </Text>{" "}
                  {a.message}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </div>

      <Table aria-label="Trust-center fleet" striped highlightOnHover withTableBorder>
        <caption style={{ textAlign: "left", captionSide: "top" }}>
          Trust-center nodes — health, version, and on-chain quorum weight
        </caption>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Node</Table.Th>
            <Table.Th scope="col">Location</Table.Th>
            <Table.Th scope="col">Status</Table.Th>
            <Table.Th scope="col">Version</Table.Th>
            <Table.Th scope="col">Weight</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {fleet.nodes.map((n) => (
            <Table.Tr key={n.address}>
              <Table.Th scope="row">{n.name}</Table.Th>
              <Table.Td>{n.location ?? "—"}</Table.Td>
              <Table.Td>
                <StatusChip node={n} />
              </Table.Td>
              <Table.Td>
                {n.version ?? "—"}
                {n.targetVersion && n.targetVersion !== n.version && (
                  <Text span size="xs" c="dimmed">
                    {" "}
                    (target {n.targetVersion})
                  </Text>
                )}
              </Table.Td>
              <Table.Td>{n.onChainWeight}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Group>
        <Button
          variant="subtle"
          leftSection={<GdsIcons.Refresh size="1rem" aria-hidden />}
          onClick={() => void load()}
        >
          Refresh
        </Button>
      </Group>
    </Stack>
  );
}
