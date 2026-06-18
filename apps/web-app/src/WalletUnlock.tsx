/**
 * Wallet unlock gate. The wallet (and mining/marketplace) is the value layer,
 * authorized only by the user's KEY: their downloaded key-backup file (.json)
 * plus its password. Decryption is entirely client-side; the key never leaves
 * the browser and is held in memory only for the session. This is the deliberate
 * step that separates "identified" from "can spend / mine".
 */
import { useState } from "react";
import { Anchor, Button, FileButton, Group, Paper, PasswordInput, Stack, Text, Title } from "@mantine/core";
import type { Hex } from "viem";
import { decryptWallet, addressOf } from "./crypto.js";
import { parseBackup, type KeyBackup } from "./keybackup.js";
import { useSession } from "./session.js";

export function WalletUnlock({ action }: { action?: string }) {
  const { session, unlockWallet } = useSession();
  const [backup, setBackup] = useState<KeyBackup | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setError(null);
    if (!file) return;
    try {
      setBackup(parseBackup(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "invalid backup file");
    }
  }

  function handleUnlock() {
    setError(null);
    if (!backup) {
      setError("Choose your key backup file first.");
      return;
    }
    setBusy(true);
    try {
      let key: Hex;
      try {
        key = decryptWallet(password, backup.vault_ciphertext, backup.iv, backup.kdf_params);
      } catch {
        throw new Error("Couldn't unlock — check the password for this key.");
      }
      if (addressOf(key).toLowerCase() !== backup.address.toLowerCase()) {
        throw new Error("Couldn't unlock — check the password for this key.");
      }
      if (session && session.address.toLowerCase() !== backup.address.toLowerCase()) {
        throw new Error("This key is for a different account than you're signed in as.");
      }
      unlockWallet(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unlock failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper withBorder p="xl" radius="md" maw={460} mx="auto" mt="xl">
      <Stack gap="sm">
        <Title order={4}>Unlock your wallet</Title>
        <Text size="sm" c="dimmed">
          {action ?? "Your wallet and mining are protected by your key."} Upload your key
          backup file and enter its password to authorize this device for the session.
        </Text>
        <Group gap="sm">
          <FileButton onChange={handleFile} accept="application/json,.json">
            {(props) => (
              <Button {...props} variant="light" size="xs">
                {backup ? "Choose a different file" : "Upload key file (.json)"}
              </Button>
            )}
          </FileButton>
          {backup && (
            <Text size="xs" c="dimmed">
              {backup.address.slice(0, 10)}…
            </Text>
          )}
        </Group>
        <PasswordInput
          label="Key password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          autoComplete="current-password"
        />
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Button onClick={handleUnlock} loading={busy} disabled={!backup || password.length < 8}>
          Unlock wallet
        </Button>
        <Text size="xs" c="dimmed">
          Don't have your key file? Sign in on the device where you created the account and use
          “Download key”, or <Anchor href="/support" target="_blank">contact support</Anchor>.
        </Text>
      </Stack>
    </Paper>
  );
}
