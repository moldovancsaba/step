/**
 * App shell (#3) + auth gate (#13). Signed-out users see the GDS AuthShell login
 * wall; signed-in users get the GDS AppShell with primary nav (Map, Wallet) and
 * an account panel. The wallet key lives only in memory for the session.
 *
 * Mine and Marketplace surfaces are their own issues (#21 capture, #11 market);
 * their nav entries are present and route to placeholders so the shell contract
 * is complete.
 */
import { useState, type ReactNode } from "react";
import { AppShell, EmptyState } from "@doneisbetter/gds";
import { Button, Group, NavLink, Stack, Text } from "@mantine/core";
import { IconMap2, IconWallet, IconPick, IconBuildingStore } from "@tabler/icons-react";
import { useSession } from "./session.js";
import { LoginWall } from "./LoginWall.js";
import { MapView } from "./MapView.js";
import { WalletView } from "./WalletView.js";
import { Footer } from "./Footer.js";
import { loadBackup, downloadBackup } from "./keybackup.js";

type Tab = "map" | "wallet" | "mine" | "market";

const NAV: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "map", label: "Map", icon: <IconMap2 size={18} /> },
  { key: "wallet", label: "Wallet", icon: <IconWallet size={18} /> },
  { key: "mine", label: "Mine", icon: <IconPick size={18} /> },
  { key: "market", label: "Marketplace", icon: <IconBuildingStore size={18} /> },
];

export function App() {
  const { session, logout } = useSession();
  const [tab, setTab] = useState<Tab>("map");

  if (!session)
    return (
      <>
        <LoginWall />
        <Footer />
      </>
    );

  const nav = (
    <Stack gap={4}>
      {NAV.map((n) => (
        <NavLink
          key={n.key}
          label={n.label}
          leftSection={n.icon}
          active={tab === n.key}
          onClick={() => setTab(n.key)}
        />
      ))}
    </Stack>
  );

  const backup = loadBackup(session.identity);
  const accountPanel = (
    <Group gap="sm">
      <Text size="sm">{session.identity}</Text>
      {backup && (
        <Button size="xs" variant="subtle" onClick={() => downloadBackup(backup)}>
          Download key
        </Button>
      )}
      <Button size="xs" variant="subtle" onClick={() => void logout()}>
        Sign out
      </Button>
    </Group>
  );

  return (
    <AppShell
      logoText="STEP"
      primaryNavigation={nav}
      accountPanel={accountPanel}
      showThemeToggle
    >
      {tab === "map" && <MapView />}
      {tab === "wallet" && <WalletView />}
      {tab === "mine" && (
        <EmptyState
          title="Mining comes next"
          description="The web capture flow (proof of presence) is delivered in issue #21."
        />
      )}
      {tab === "market" && (
        <EmptyState
          title="Marketplace coming soon"
          description="Browsing, buying, gifting and listing triangle NFTs is issue #11."
        />
      )}
      <Footer />
    </AppShell>
  );
}
