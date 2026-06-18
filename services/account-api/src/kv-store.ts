/**
 * Cloudflare Workers KV adapter for AccountStore — the deploy backend for the
 * account-api Worker (mirrors the Postgres adapter's role). Stores one JSON row
 * per identity under `acct:<identity>`. KV is eventually consistent, which is
 * acceptable here: an identity is keyed uniquely and writes are rare (register
 * + occasional vault rotation). Same zero-knowledge contract as the interface —
 * only the verifier, address, and opaque vault ciphertext are stored.
 */
import { randomUUID } from "node:crypto";
import {
  IdentityTakenError,
  type AccountStore,
  type AccountRow,
  type NewAccount,
} from "./store.js";

/** Minimal slice of the Workers KVNamespace we use (avoids a types dependency). */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export class KvAccountStore implements AccountStore {
  constructor(private readonly kv: KvLike) {}

  private key(identity: string): string {
    return `acct:${identity}`;
  }

  async insert(a: NewAccount): Promise<AccountRow> {
    if (await this.kv.get(this.key(a.identity))) {
      throw new IdentityTakenError(a.identity);
    }
    const now = new Date().toISOString();
    const row: AccountRow = {
      id: randomUUID(),
      identity: a.identity,
      auth_hash: a.auth_hash,
      address: a.address,
      vault_ciphertext: a.vault_ciphertext,
      kdf_params: a.kdf_params,
      iv: a.iv,
      created_at: now,
      updated_at: now,
    };
    await this.kv.put(this.key(a.identity), JSON.stringify(row));
    return row;
  }

  async byIdentity(identity: string): Promise<AccountRow | undefined> {
    const v = await this.kv.get(this.key(identity));
    return v ? (JSON.parse(v) as AccountRow) : undefined;
  }

  async updateVault(identity: string, vault_ciphertext: string, iv: string): Promise<boolean> {
    const v = await this.kv.get(this.key(identity));
    if (!v) return false;
    const row = JSON.parse(v) as AccountRow;
    row.vault_ciphertext = vault_ciphertext;
    row.iv = iv;
    row.updated_at = new Date().toISOString();
    await this.kv.put(this.key(identity), JSON.stringify(row));
    return true;
  }
}
