/**
 * Trusted-device key storage on the web — the browser equivalent of iOS's
 * Secure Enclave. Raw hardware IDs (IMEI/MAC) are NOT readable in a browser, so
 * we use a **platform passkey (WebAuthn)** as the hardware trust anchor: the
 * authenticator (Secure Enclave / TPM, biometric-gated) derives a stable secret
 * via the WebAuthn **PRF extension**, and we wrap the wallet key with it. The
 * wrapped key is stored locally but is useless without the device's
 * authenticator + the user's biometric — so a trusted device can auto-load the
 * key, while no one can extract it from disk.
 *
 * Feature-detected and additive: if the browser lacks a platform authenticator
 * or PRF, "trust this device" is simply unavailable and the key-file unlock path
 * is unchanged (no regression).
 */
import type { Hex } from "viem";

const PRF_SALT_LABEL = (() => {
  const e = new TextEncoder().encode("step.trusteddevice.prf.v1");
  const u = new Uint8Array(new ArrayBuffer(e.length));
  u.set(e);
  return u;
})();
const credStoreKey = (id: string) => `step.trust.${id.toLowerCase()}`;

interface TrustRecord {
  credentialId: string; // base64url
  iv: string; // base64
  wrapped: string; // base64 (AES-GCM ciphertext of the wallet key bytes)
}

// Allocate ArrayBuffer-backed Uint8Arrays (TextEncoder/Uint8Array.from yield
// ArrayBufferLike, which TS rejects for the DOM's BufferSource / AES-GCM args).
function alloc(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(n));
}
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const u = alloc(n);
  crypto.getRandomValues(u);
  return u;
}
const textBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const e = new TextEncoder().encode(s);
  const u = alloc(e.length);
  u.set(e);
  return u;
};
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const u = alloc(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  fromB64(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
const hexToBytes = (h: Hex): Uint8Array<ArrayBuffer> => {
  const hex = h.slice(2);
  const u = alloc(hex.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
  return u;
};
const bytesToHex = (b: Uint8Array) =>
  ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;

/** Is a platform authenticator (Secure Enclave / Touch ID / Windows Hello) here? */
export async function trustedDeviceSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isDeviceTrusted(identity: string): boolean {
  return localStorage.getItem(credStoreKey(identity)) !== null;
}

export function untrustDevice(identity: string): void {
  localStorage.removeItem(credStoreKey(identity));
}

async function aesGcm(
  mode: "encrypt" | "decrypt",
  secret: ArrayBuffer,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
) {
  const key = await crypto.subtle.importKey("raw", secret, "AES-GCM", false, [mode]);
  const out = await crypto.subtle[mode]({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(out);
}

type PrfResults = { results?: { first?: ArrayBuffer } };

/** Register a platform passkey + derive a PRF secret, and wrap the wallet key. */
export async function trustThisDevice(identity: string, walletKey: Hex): Promise<void> {
  const userId = textBytes(identity);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "STEP", id: location.hostname },
      user: { id: userId, name: identity, displayName: identity },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required",
      },
      extensions: { prf: { eval: { first: PRF_SALT_LABEL } } },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Couldn't register this device.");

  const secret = await prfSecret(cred);
  const iv = randomBytes(12);
  const wrapped = await aesGcm("encrypt", secret, iv, hexToBytes(walletKey));
  const rec: TrustRecord = {
    credentialId: b64url(new Uint8Array(cred.rawId)),
    iv: b64(iv),
    wrapped: b64(wrapped),
  };
  localStorage.setItem(credStoreKey(identity), JSON.stringify(rec));
}

/** Biometric-unlock the wallet key on a trusted device. Null if not trusted. */
export async function loadTrustedKey(identity: string): Promise<Hex | null> {
  const raw = localStorage.getItem(credStoreKey(identity));
  if (!raw) return null;
  const rec = JSON.parse(raw) as TrustRecord;
  const assertion = (await navigator.credentials.get({
    publicKey: {
      rpId: location.hostname,
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: fromB64url(rec.credentialId) }],
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT_LABEL } } },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return null;
  const secret = await prfSecret(assertion);
  const keyBytes = await aesGcm("decrypt", secret, fromB64(rec.iv), fromB64(rec.wrapped));
  return bytesToHex(keyBytes);
}

/** Extract the 32-byte PRF output; throws if the authenticator lacks PRF. */
async function prfSecret(cred: PublicKeyCredential): Promise<ArrayBuffer> {
  const ext = cred.getClientExtensionResults() as { prf?: PrfResults };
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new Error("This device doesn't support hardware key binding (WebAuthn PRF).");
  }
  return first;
}
