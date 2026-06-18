/**
 * Login wall (#13) on GDS AuthShell. This is the IDENTITY layer only: a simple
 * email + password sign-in identifies the user — it does NOT unlock the wallet.
 * After signing in, the wallet (and mining/marketplace) stay locked until the
 * user authorizes them with their KEY (their downloaded key-backup file) on the
 * in-app unlock gate. See WalletUnlock.tsx.
 *
 * Sign-in derives the authKey from the password using the account's KDF salt,
 * fetched from the server (/v1/kdf) so it works on ANY device with no local
 * cache and no key file. Register generates/encrypts the wallet, saves a
 * downloadable backup, and unlocks the wallet once (the user just created it).
 */
import { useState } from "react";
import { AuthShell, FormField } from "@doneisbetter/gds";
import { Button, PasswordInput, Stack, Text, TextInput, Anchor, Textarea } from "@mantine/core";
import type { Hex } from "viem";
import { account } from "./api.js";
import { encryptWallet, decryptWallet, deriveAuthKey, newWalletKey, addressOf } from "./crypto.js";
import { saveBackup } from "./keybackup.js";
import { useSession } from "./session.js";

type Mode = "sign-in" | "sign-up";

const kdfKey = (identity: string) => `step.kdf.${identity.toLowerCase()}`;

export function LoginWall() {
  const { signIn, unlockWallet } = useSession();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [importKey, setImportKey] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp() {
    setBusy(true);
    setError(null);
    try {
      const key: Hex =
        showImport && importKey.trim() ? (importKey.trim() as Hex) : newWalletKey();
      const blob = encryptWallet(password, key);
      await account.register({
        identity,
        authKey: blob.authKey,
        address: blob.address,
        vault_ciphertext: blob.vault_ciphertext,
        iv: blob.iv,
        kdf_params: blob.kdf_params,
      });
      localStorage.setItem(kdfKey(identity), JSON.stringify(blob.kdf_params));
      // Establish the server session cookie so a refresh keeps you signed in
      // (register alone sets no cookie — only login does).
      await account.login(identity, blob.authKey);
      // A downloadable encrypted key backup — the user's wallet authentication.
      saveBackup({
        format: "step.keybackup.v1",
        identity: identity.toLowerCase(),
        address: blob.address,
        vault_ciphertext: blob.vault_ciphertext,
        iv: blob.iv,
        kdf_params: blob.kdf_params,
      });
      // New account: identify AND unlock once (they hold the key now). Prompt to
      // download it — it's required to unlock the wallet on any future session.
      signIn(identity.toLowerCase(), blob.address);
      unlockWallet(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "registration failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      // Identity only: fetch the (non-secret) KDF salt, derive the authKey, and
      // verify with the account API. The wallet is NOT decrypted here.
      const { kdf_params } = await account.kdf(identity);
      const authKey = deriveAuthKey(password, kdf_params);
      const res = await account.login(identity, authKey);
      localStorage.setItem(kdfKey(identity), JSON.stringify(res.kdf_params));
      // Keep an encrypted backup available for download (not auto-unlocked).
      saveBackup({
        format: "step.keybackup.v1",
        identity: identity.toLowerCase(),
        address: res.address,
        vault_ciphertext: res.vault_ciphertext,
        iv: res.iv,
        kdf_params: res.kdf_params,
      });
      signIn(identity.toLowerCase(), res.address); // wallet stays LOCKED
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  const valid = identity.trim().length >= 3 && password.length >= 8;
  const importedAddress =
    showImport && importKey.trim().startsWith("0x") && importKey.trim().length === 66
      ? addressOf(importKey.trim() as Hex)
      : null;

  return (
    <AuthShell
      title={mode === "sign-in" ? "Sign in to STEP" : "Create your STEP account"}
      intent={mode}
      description="Signing in identifies you. Your wallet stays locked until you unlock it with your key — we never see your key or password."
      error={error ?? undefined}
      footer={
        <Text size="sm">
          {mode === "sign-in" ? "New to STEP? " : "Already have an account? "}
          <Anchor onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
            {mode === "sign-in" ? "Create an account" : "Sign in"}
          </Anchor>
        </Text>
      }
    >
      <Stack gap="md">
        <FormField label="Email or username">
          <TextInput
            value={identity}
            onChange={(e) => setIdentity(e.currentTarget.value)}
            placeholder="you@example.com"
            autoComplete="username"
          />
        </FormField>
        <FormField
          label="Password"
          description="Used to derive your encryption key. Minimum 8 characters."
        >
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
        </FormField>

        {mode === "sign-up" && (
          <FormField
            label="Wallet"
            description={
              showImport
                ? "Paste an existing private key (advanced)."
                : "A new wallet will be generated. Download your key backup afterwards — it's how you unlock the wallet later."
            }
          >
            <Stack gap="xs">
              <Anchor size="sm" onClick={() => setShowImport((s) => !s)}>
                {showImport ? "Generate a new wallet instead" : "Import an existing key (advanced)"}
              </Anchor>
              {showImport && (
                <Textarea
                  value={importKey}
                  onChange={(e) => setImportKey(e.currentTarget.value)}
                  placeholder="0x…"
                  autosize
                  minRows={2}
                />
              )}
              {importedAddress && (
                <Text size="xs" c="dimmed">
                  Address: {importedAddress}
                </Text>
              )}
            </Stack>
          </FormField>
        )}

        <Button
          fullWidth
          loading={busy}
          disabled={!valid}
          onClick={mode === "sign-in" ? handleSignIn : handleSignUp}
        >
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </Stack>
    </AuthShell>
  );
}
