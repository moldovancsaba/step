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
import { AppShell, EmptyState, GdsIcons } from "@sovereignsquad/gds";
import { Button, Center, Group, Loader, NavLink, Stack, Text } from "@mantine/core";
import { useSession } from "./session.js";
import { LoginWall } from "./LoginWall.js";
import { MapView } from "./MapView.js";
import { FleetView } from "./FleetView.js";
import { WalletView } from "./WalletView.js";
import { WalletUnlock } from "./WalletUnlock.js";
import { Footer } from "./Footer.js";
import { loadBackup, downloadBackup } from "./keybackup.js";
import { isDeviceTrusted, untrustDevice } from "./trusteddevice.js";

type Tab = "map" | "wallet" | "mine" | "market" | "fleet";

const NAV: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "map", label: "Map", icon: <GdsIcons.Home size="1.125rem" /> },
  { key: "wallet", label: "Wallet", icon: <GdsIcons.Trophy size="1.125rem" /> },
  { key: "mine", label: "Mine", icon: <GdsIcons.Goal size="1.125rem" /> },
  { key: "market", label: "Marketplace", icon: <GdsIcons.Grid size="1.125rem" /> },
  { key: "fleet", label: "Fleet", icon: <GdsIcons.Analytics size="1.125rem" /> },
];

export function App() {
  const { restoring, session, walletUnlocked, lockWallet, logout } = useSession();
  const [tab, setTab] = useState<Tab>("map");
  const surface = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("surface");

  if (surface === "ios-map") {
    return (
      <main style={{ minHeight: "100vh", padding: 0 }}>
        <MapView />
      </main>
    );
  }

  // Don't flash the login wall while the cookie session is being restored.
  if (restoring)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );

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
          // GDS DiscoveryShell closes the mobile drawer on click of an element
          // matching this hook; Mantine NavLink (an <a> without href) otherwise
          // wouldn't match, so the drawer would stay open after selecting a tab.
          data-gds-nav-close
        />
      ))}
    </Stack>
  );

  const backup = loadBackup(session.identity);
  const accountPanel = (
    <Group gap="sm">
      <Text size="sm">{session.identity}</Text>
      <Text size="xs" c={walletUnlocked ? "teal" : "dimmed"}>
        {walletUnlocked ? "wallet unlocked" : "wallet locked"}
      </Text>
      {walletUnlocked && backup && (
        <Button size="xs" variant="subtle" onClick={() => downloadBackup(backup)}>
          Download key
        </Button>
      )}
      {walletUnlocked && (
        <Button size="xs" variant="subtle" onClick={() => lockWallet()}>
          Lock wallet
        </Button>
      )}
      {isDeviceTrusted(session.identity) && (
        <Button
          size="xs"
          variant="subtle"
          color="red"
          onClick={() => {
            untrustDevice(session.identity);
            lockWallet();
          }}
        >
          Forget device
        </Button>
      )}
      <Button size="xs" variant="subtle" onClick={() => void logout()}>
        Sign out
      </Button>
    </Group>
  );

  // The wallet/value surfaces require the key (the authentication layer); the
  // map is public and only needs identity.
  const gate = (node: ReactNode, action: string) =>
    walletUnlocked ? node : <WalletUnlock action={action} />;

  return (
    <AppShell
      logoText="STEP"
      primaryNavigation={nav}
      accountPanel={accountPanel}
      showThemeToggle
    >
      {tab === "map" && <MapView />}
      {tab === "fleet" && <FleetView />}
      {tab === "wallet" && gate(<WalletView />, "Your wallet is protected by your key.")}
      {tab === "mine" &&
        gate(
          <EmptyState
            title="Mining comes next"
            description="The web capture flow (proof of presence) is delivered in issue #21."
          />,
          "Mining requires your key.",
        )}
      {tab === "market" &&
        gate(
          <EmptyState
            title="Marketplace coming soon"
            description="Browsing, buying, gifting and listing triangle NFTs is issue #11."
          />,
          "Trading requires your key.",
        )}
      <Footer />
    </AppShell>
  );
}
