/**
 * Client-side zero-knowledge wallet crypto (matches services/account-api, #12).
 * The password never leaves the browser: Argon2id derives 64 bytes split into
 * authKey (sent to the server as a verifier input) and wrapKey (stays local).
 * The wallet private key is AES-256-GCM-encrypted under wrapKey; the server only
 * ever stores opaque ciphertext + the Argon2id verifier + the public address.
 */
import { argon2id } from "@noble/hashes/argon2";
import { gcm } from "@noble/ciphers/aes";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

const utf8 = (s: string) => new TextEncoder().encode(s);
export const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const fromB64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Client KDF cost. Tuned for an interactive browser login (sub-second on
// modern hardware); server-side verifier adds a second Argon2id pass (#14).
export const KDF = { m: 19_456, t: 2, p: 1 } as const;

export interface KdfParams {
  algo: "argon2id";
  m: number;
  t: number;
  p: number;
  salt: string; // base64
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Derive { authKey (sent), wrapKey (local-only) } from a password + salt. */
export function deriveKeys(password: string, salt: Uint8Array): { authKey: string; wrapKey: Uint8Array } {
  const dk = argon2id(utf8(password), salt, { ...KDF, dkLen: 64 });
  return { authKey: b64(dk.slice(0, 32)), wrapKey: dk.slice(32, 64) };
}

export interface VaultBlob {
  vault_ciphertext: string; // base64
  iv: string; // base64
  kdf_params: KdfParams;
  authKey: string;
  address: Hex;
}

/** Encrypt a wallet private key into a server-storable vault blob. */
export function encryptWallet(password: string, privateKey: Hex): VaultBlob {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const { authKey, wrapKey } = deriveKeys(password, salt);
  const keyBytes = fromB64(b64(hexToBytes(privateKey)));
  const ciphertext = gcm(wrapKey, iv).encrypt(keyBytes);
  const address = privateKeyToAccount(privateKey).address;
  return {
    vault_ciphertext: b64(ciphertext),
    iv: b64(iv),
    kdf_params: { algo: "argon2id", salt: b64(salt), ...KDF },
    authKey,
    address,
  };
}

/** Decrypt a vault blob back to the in-memory wallet private key. */
export function decryptWallet(
  password: string,
  vault_ciphertext: string,
  iv: string,
  kdf_params: KdfParams,
): Hex {
  const { wrapKey } = deriveKeys(password, fromB64(kdf_params.salt));
  const key = gcm(wrapKey, fromB64(iv)).decrypt(fromB64(vault_ciphertext));
  return bytesToHex(key);
}

/** Re-derive only the authKey for login (no wallet decrypt needed yet). */
export function deriveAuthKey(password: string, kdf_params: KdfParams): string {
  return deriveKeys(password, fromB64(kdf_params.salt)).authKey;
}

export function newWalletKey(): Hex {
  return generatePrivateKey();
}

export function addressOf(privateKey: Hex): Hex {
  return privateKeyToAccount(privateKey).address;
}

function hexToBytes(hex: Hex): Uint8Array {
  const h = hex.slice(2);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): Hex {
  return ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
}
