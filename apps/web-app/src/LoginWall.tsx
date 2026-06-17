/**
 * Login wall (#13) on GDS AuthShell + FormField + Mantine inputs (themed by
 * GdsProvider). Register derives keys client-side, generates or imports a
 * wallet, encrypts it, and posts only the verifier + ciphertext (#12 zero-
 * knowledge). Sign-in derives the authKey, fetches the ciphertext, and decrypts
 * the wallet into the in-memory session. Copy/paste token import is retained as
 * an advanced recovery option.
 *
 * KDF salt bootstrap: account-api returns kdf_params only on a successful login,
 * so to derive the authKey the client needs the (non-secret) salt up front. For
 * the pilot we cache kdf_params locally at register time (same-device sign-in).
 * A fresh device uses token import or re-registration; the cross-device salt
 * endpoint is hardening #14. The salt is not secret, so caching it is safe.
 */
import { useState } from "react";
import { AuthShell, FormField } from "@doneisbetter/gds";
import { Button, PasswordInput, Stack, Text, TextInput, Anchor, Textarea } from "@mantine/core";
import type { Hex } from "viem";
import { account } from "./api.js";
import {
  encryptWallet,
  decryptWallet,
  deriveAuthKey,
  newWalletKey,
  addressOf,
  type KdfParams,
} from "./crypto.js";
import { useSession } from "./session.js";

type Mode = "sign-in" | "sign-up";

const kdfKey = (identity: string) => `step.kdf.${identity.toLowerCase()}`;

export function LoginWall() {
  const { setSignedIn } = useSession();
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
      // Cache the (non-secret) salt so same-device sign-in can derive authKey.
      localStorage.setItem(kdfKey(identity), JSON.stringify(blob.kdf_params));
      const res = await account.login(identity, blob.authKey);
      const walletKey = decryptWallet(password, res.vault_ciphertext, res.iv, res.kdf_params);
      setSignedIn(identity.toLowerCase(), res.address, walletKey);
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
      const cached = localStorage.getItem(kdfKey(identity));
      if (!cached) {
        throw new Error(
          "No saved key parameters on this device. Sign up here, or import your key.",
        );
      }
      const kdf = JSON.parse(cached) as KdfParams;
      const authKey = deriveAuthKey(password, kdf);
      const res = await account.login(identity, authKey);
      const walletKey = decryptWallet(password, res.vault_ciphertext, res.iv, res.kdf_params);
      setSignedIn(identity.toLowerCase(), res.address, walletKey);
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
      description="Your wallet is encrypted on this device and never leaves it unencrypted. We never see your key or password."
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
              showImport ? "Paste an existing private key (advanced)." : "A new wallet will be generated."
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
