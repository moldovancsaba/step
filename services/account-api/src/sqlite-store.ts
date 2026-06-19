/**
 * Durable account store backed by SQLite (Node's built-in `node:sqlite` — no
 * external dependency, a single file on this machine). This is what makes the
 * local-first backend a real solution rather than a demo: accounts and their
 * encrypted wallet vaults survive a restart.
 *
 * Stores exactly what {@link InMemoryAccountStore} does — the zero-knowledge row
 * (auth verifier, address, vault ciphertext, KDF/IV). NO private key, NO
 * password. KDF params are JSON-encoded in a column.
 */
import { DatabaseSync } from "node:sqlite";
import {
  IdentityTakenError,
  type AccountRow,
  type AccountStore,
  type KdfParams,
  type NewAccount,
} from "./store.js";

/** The row shape returned by SQLite (all columns are TEXT NOT NULL). */
interface SqliteRow {
  id: string;
  identity: string;
  auth_hash: string;
  address: string;
  vault_ciphertext: string;
  kdf_params: string;
  iv: string;
  created_at: string;
  updated_at: string;
}

export class SqliteAccountStore implements AccountStore {
  private db: DatabaseSync;

  constructor(
    path: string,
    private now: () => string = () => new Date().toISOString(),
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id               TEXT PRIMARY KEY,
        identity         TEXT NOT NULL UNIQUE,
        auth_hash        TEXT NOT NULL,
        address          TEXT NOT NULL,
        vault_ciphertext TEXT NOT NULL,
        kdf_params       TEXT NOT NULL,
        iv               TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      )
    `);
  }

  async insert(a: NewAccount): Promise<AccountRow> {
    const ts = this.now();
    const id = `acct_${ts}_${a.identity}`;
    try {
      this.db
        .prepare(
          `INSERT INTO accounts
             (id, identity, auth_hash, address, vault_ciphertext, kdf_params, iv, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          a.identity,
          a.auth_hash,
          a.address,
          a.vault_ciphertext,
          JSON.stringify(a.kdf_params),
          a.iv,
          ts,
          ts,
        );
    } catch (e) {
      if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
        throw new IdentityTakenError(a.identity);
      }
      throw e;
    }
    return { id, created_at: ts, updated_at: ts, ...a };
  }

  async byIdentity(identity: string): Promise<AccountRow | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM accounts WHERE identity = ?`)
      .get(identity) as SqliteRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  async updateVault(identity: string, vault_ciphertext: string, iv: string): Promise<boolean> {
    const res = this.db
      .prepare(`UPDATE accounts SET vault_ciphertext = ?, iv = ?, updated_at = ? WHERE identity = ?`)
      .run(vault_ciphertext, iv, this.now(), identity);
    return res.changes > 0;
  }

  private hydrate(row: SqliteRow): AccountRow {
    return {
      id: row.id,
      identity: row.identity,
      auth_hash: row.auth_hash,
      address: row.address as `0x${string}`,
      vault_ciphertext: row.vault_ciphertext,
      kdf_params: JSON.parse(row.kdf_params) as KdfParams,
      iv: row.iv,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
