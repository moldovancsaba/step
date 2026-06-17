/**
 * Account persistence behind a small interface so the same service runs on an
 * in-memory backend (dev/tests) and Postgres (deploy). The stored row is the
 * whole zero-knowledge contract: a server-side verifier of the client's
 * authKey, the public address, the opaque vault ciphertext, and KDF/IV params.
 * It contains NO wallet private key and NO password (see STEP_account_vault.md).
 */
export interface KdfParams {
  algo: "argon2id";
  m: number; // memory cost (KiB)
  t: number; // time cost (iterations)
  p: number; // parallelism
  salt: string; // base64; client-side KDF salt
}

export interface AccountRow {
  id: string;
  identity: string; // normalized email or username (unique)
  auth_hash: string; // server-side verifier of the client authKey (never the password)
  address: `0x${string}`; // public wallet address (display/index only)
  vault_ciphertext: string; // AES-GCM ciphertext of the wallet private key (base64)
  kdf_params: KdfParams;
  iv: string; // AES-GCM iv (base64)
  created_at: string;
  updated_at: string;
}

export interface NewAccount {
  identity: string;
  auth_hash: string;
  address: `0x${string}`;
  vault_ciphertext: string;
  kdf_params: KdfParams;
  iv: string;
}

export interface AccountStore {
  /** Insert a new account. Throws `IdentityTakenError` if the identity exists. */
  insert(a: NewAccount): Promise<AccountRow>;
  byIdentity(identity: string): Promise<AccountRow | undefined>;
  /** Rotate the vault ciphertext/iv (e.g. password change re-wrap). */
  updateVault(identity: string, vault_ciphertext: string, iv: string): Promise<boolean>;
}

export class IdentityTakenError extends Error {
  constructor(identity: string) {
    super(`identity taken: ${identity}`);
    this.name = "IdentityTakenError";
  }
}

/** Dev/test backend. Last-write-wins on vault rotation (documented). */
export class InMemoryAccountStore implements AccountStore {
  private byId = new Map<string, AccountRow>();
  private seq = 0;

  constructor(private now: () => string = () => new Date().toISOString()) {}

  async insert(a: NewAccount): Promise<AccountRow> {
    if (this.byId.has(a.identity)) throw new IdentityTakenError(a.identity);
    const ts = this.now();
    const row: AccountRow = { id: `acct_${++this.seq}`, created_at: ts, updated_at: ts, ...a };
    this.byId.set(a.identity, row);
    return row;
  }

  async byIdentity(identity: string): Promise<AccountRow | undefined> {
    return this.byId.get(identity);
  }

  async updateVault(identity: string, vault_ciphertext: string, iv: string): Promise<boolean> {
    const row = this.byId.get(identity);
    if (!row) return false;
    row.vault_ciphertext = vault_ciphertext;
    row.iv = iv;
    row.updated_at = this.now();
    return true;
  }
}
