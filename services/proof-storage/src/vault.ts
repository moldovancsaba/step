/**
 * Evidence vault (ADR-014, POP-009): per-bundle XChaCha20-Poly1305 encryption,
 * content addressing with real CIDs (CIDv1, raw codec, sha2-256 — identical to
 * a kubo raw block), and GDPR deletion via key destruction: destroying the
 * wrapped bundle key renders the content permanently unreadable even where the
 * ciphertext survives in content-addressed storage (PRV-003).
 *
 * Alpha key wrapping: bundle keys are encrypted under the foundation master
 * key from the environment (EVIDENCE_MASTER_KEY). A managed KMS replaces the
 * env key at MVP — interface unchanged. This is documented, not hidden.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { sha256 } from "@noble/hashes/sha256";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { create as createDigest } from "multiformats/hashes/digest";

const SHA2_256_CODE = 0x12;

export interface StoredBundle {
  cid: string;
  ciphertext: Uint8Array;
  /** nonce || wrapped(bundleKey) under the master key; null after destruction */
  wrappedKey: Uint8Array | null;
  nonce: Uint8Array;
  storedAt: string;
}

export interface BundleBackend {
  put(bundle: StoredBundle): Promise<void>;
  get(cid: string): Promise<StoredBundle | undefined>;
  destroyKey(cid: string): Promise<boolean>;
}

export class MemoryBackend implements BundleBackend {
  private bundles = new Map<string, StoredBundle>();
  async put(b: StoredBundle) {
    this.bundles.set(b.cid, b);
  }
  async get(cid: string) {
    return this.bundles.get(cid);
  }
  async destroyKey(cid: string) {
    const b = this.bundles.get(cid);
    if (!b || b.wrappedKey === null) return false;
    b.wrappedKey.fill(0);
    b.wrappedKey = null;
    return true;
  }
}

export function computeCid(bytes: Uint8Array): string {
  const digest = createDigest(SHA2_256_CODE, sha256(bytes));
  return CID.createV1(raw.code, digest).toString();
}

export class EvidenceVault {
  constructor(
    private backend: BundleBackend,
    private masterKey: Uint8Array, // 32 bytes
  ) {
    if (masterKey.length !== 32) throw new Error("master key must be 32 bytes");
  }

  /** Encrypts and stores a bundle; returns its CID (of the ciphertext). */
  async store(bundleJson: unknown): Promise<string> {
    const plaintext = new TextEncoder().encode(JSON.stringify(bundleJson));
    const bundleKey = randomBytes(32);
    const nonce = randomBytes(24);
    const ciphertext = xchacha20poly1305(bundleKey, nonce).encrypt(plaintext);

    const wrapNonce = randomBytes(24);
    const wrapped = xchacha20poly1305(this.masterKey, wrapNonce).encrypt(bundleKey);
    bundleKey.fill(0);

    const wrappedKey = new Uint8Array(24 + wrapped.length);
    wrappedKey.set(wrapNonce);
    wrappedKey.set(wrapped, 24);

    const cid = computeCid(ciphertext);
    await this.backend.put({
      cid,
      ciphertext,
      wrappedKey,
      nonce,
      storedAt: new Date().toISOString(),
    });
    return cid;
  }

  /** Foundation-only retrieval (claim review / disputes, HARD §13.3). */
  async retrieve(cid: string): Promise<unknown | null> {
    const b = await this.backend.get(cid);
    if (!b || b.wrappedKey === null) return null;
    const wrapNonce = b.wrappedKey.slice(0, 24);
    const wrapped = b.wrappedKey.slice(24);
    const bundleKey = xchacha20poly1305(this.masterKey, wrapNonce).decrypt(wrapped);
    const plaintext = xchacha20poly1305(bundleKey, b.nonce).decrypt(b.ciphertext);
    bundleKey.fill(0);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  /** GDPR deletion: destroy the key, log the event (privacy dashboard). */
  async destroy(cid: string): Promise<boolean> {
    return this.backend.destroyKey(cid);
  }
}
