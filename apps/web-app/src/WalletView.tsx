/**
 * Wallet view: shows the signed-in address and the slot NFTs owned (#7), each
 * with provenance (triangle, level, slot, landlord flag). Read-only here;
 * listing/trading lands with the marketplace UI (#11).
 */
import { useEffect, useState } from "react";
import { EmptyState, MetricCard } from "@sovereignsquad/gds";
import { Badge, Card, Group, Stack, Text } from "@mantine/core";
import { nft, type NftToken } from "./api.js";
import { useSession } from "./session.js";

export function WalletView() {
  const { session } = useSession();
  const [tokens, setTokens] = useState<NftToken[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session) return;
    nft
      .owned(session.address)
      .then(setTokens)
      .catch(() => setTokens([]))
      .finally(() => setLoaded(true));
  }, [session]);

  if (!session) return null;

  return (
    <Stack gap="md">
      <Group grow>
        <MetricCard label="Address" value={<Text size="sm" ff="monospace">{session.address}</Text>} />
        <MetricCard label="Triangles owned" value={tokens.length} description="mined slot NFTs" />
      </Group>

      {loaded && tokens.length === 0 ? (
        <EmptyState
          title="No triangles yet"
          description="Mine a triangle to earn its slot NFT. It will appear here with full provenance."
        />
      ) : (
        <Stack gap="xs">
          {tokens.map((t) => (
            <Card key={t.token_id} withBorder padding="sm">
              <Group justify="space-between">
                <Stack gap={2}>
                  <Text size="sm" ff="monospace">{t.triangle_id_hash.slice(0, 18)}…</Text>
                  <Text size="xs" c="dimmed">Level {t.level} · slot {t.slot}</Text>
                </Stack>
                {t.slot === 0 && <Badge color="grape">Landlord</Badge>}
              </Group>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
