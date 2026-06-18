/**
 * Self-custody key backup ("download your token"). A backup file is the
 * zero-knowledge encrypted vault — the SAME blob the server stores — so it is
 * safe to save to disk: it carries no plaintext key and can only be unlocked
 * with the account password. Uploading it on any device (with the password)
 * fully restores the wallet offline, without server-side KDF bootstrap — this is
 * the cross-device sign-in path.
 */
import type { Hex } from "viem";
import type { KdfParams } from "./crypto.js";

export interface KeyBackup {
  format: "step.keybackup.v1";
  identity: string;
  address: Hex;
  vault_ciphertext: string;
  iv: string;
  kdf_params: KdfParams;
}

const vaultKey = (identity: string) => `step.vault.${identity.toLowerCase()}`;

/** Persist the (encrypted) backup locally so it can be re-downloaded later. */
export function saveBackup(b: KeyBackup): void {
  localStorage.setItem(vaultKey(b.identity), JSON.stringify(b));
}

export function loadBackup(identity: string): KeyBackup | null {
  const v = localStorage.getItem(vaultKey(identity));
  return v ? (JSON.parse(v) as KeyBackup) : null;
}

/** Trigger a browser download of the backup JSON. */
export function downloadBackup(b: KeyBackup): void {
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `step-key-${b.address}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parse + validate an uploaded backup file. Throws on anything unexpected. */
export function parseBackup(text: string): KeyBackup {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const b = o as Partial<KeyBackup>;
  if (
    b?.format !== "step.keybackup.v1" ||
    typeof b.identity !== "string" ||
    typeof b.address !== "string" ||
    typeof b.vault_ciphertext !== "string" ||
    typeof b.iv !== "string" ||
    !b.kdf_params
  ) {
    throw new Error("Not a valid STEP key backup file.");
  }
  return b as KeyBackup;
}
