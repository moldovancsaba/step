# STEP Account & Encrypted Wallet Vault

Status: alpha (issue #12). Service: `services/account-api`. Public edge: `/api/account/*` via `online-gateway`.

## 1. Purpose

Give every STEP user an account (email or username + password) that securely
carries their wallet across devices **without the foundation ever holding the
key or the password**, and without SSO. This is the login wall in front of the
mobile webapp (UI in #13) while preserving self-custody.

## 2. Zero-knowledge design

The password never leaves the browser. All key material is derived and used
client-side; the server stores only an opaque verifier, the public address, and
the encrypted vault.

```
Browser (client KDF + crypto)
  password ──Argon2id(salt, m,t,p)──▶ 64 bytes
                                       ├─ authKey  (first 32 bytes)  → sent to server
                                       └─ wrapKey  (last 32 bytes)   → NEVER sent
  wrapKey ──AES-256-GCM(iv)──▶ vault_ciphertext = Enc(wallet private key)

  register: POST { identity, authKey, address, vault_ciphertext, iv, kdf_params }
  login:    POST { identity, authKey }
            ← { vault_ciphertext, iv, kdf_params, address } + Set-Cookie session
  client:   wrapKey = Argon2id(password, kdf_params.salt)[32:64]
            wallet  = AES-GCM-Dec(vault_ciphertext, wrapKey, iv)   // in memory, session only
```

### What the server stores (and only this)

| Field | Purpose | Reveals key/password? |
|-------|---------|-----------------------|
| `identity` | unique login (normalized email/username) | no |
| `auth_hash` | `Argon2id(authKey + per-row salt)` verifier | no — second pre-image of an already-high-entropy value |
| `address` | public wallet address (display/index) | no (public) |
| `vault_ciphertext` | AES-256-GCM ciphertext of the wallet private key | no — undecryptable without `wrapKey` |
| `kdf_params`, `iv` | client KDF salt/params + AES IV | no |

The server is **cryptographically incapable** of recovering the wallet key or
the password: it never receives `wrapKey` or the password, and `vault_ciphertext`
is encrypted under `wrapKey`. A full database compromise yields only opaque
ciphertext plus an Argon2id verifier of `authKey`.

## 3. Sessions

Stateless, signed token (`payloadB64url.HMAC-SHA256`) in an **HTTP-only, Secure,
SameSite=Strict** cookie. Short TTL (default 24h), expiry checked every request,
signature tamper-checked in constant time. Signing key from `SESSION_SIGNING_KEY`
(required in production).

## 4. Threat model

- **DB leak** → only verifier + opaque ciphertext + public address. No key, no
  password. Offline attack must beat client-side Argon2id per account.
- **Server compromise (read)** → cannot decrypt vaults (no `wrapKey`).
- **Server compromise (active)** → could serve malicious client JS; mitigated by
  shipping the crypto in the audited static client and SRI (out of scope here).
- **User enumeration** → login returns one generic `invalid credentials` 401 for
  both unknown identity and wrong password.
- **Replay / session theft** → short TTL + rotation; Secure+HttpOnly+Strict
  cookie reduces XSS/CSRF exfiltration. CSRF tokens & lockout: hardening #14.
- **Wrong password / corrupted vault** → server stores opaque bytes; client
  AES-GCM auth-tag failure surfaces "wrong password or corrupted vault".

## 5. API

| Method | Path | Body | Result |
|--------|------|------|--------|
| POST | `/v1/register` | `{ identity, authKey, address, vault_ciphertext, iv, kdf_params }` | `201 {ok}` / `409 identity taken` / `400 validation` |
| POST | `/v1/login` | `{ identity, authKey }` | `200 { vault_ciphertext, iv, kdf_params, address }` + cookie / `401` |
| POST | `/v1/logout` | — | `204` (clears cookie) |
| GET | `/v1/session` | — | `200 { identity, address }` / `401` |
| PUT | `/v1/vault` | `{ vault_ciphertext, iv }` (auth) | `200 {ok}` / `401` |
| GET | `/healthz` | — | `200 ok` |

Vault rotation (e.g. password change re-wrap) is **last-write-wins** by
`updated_at` across devices.

## 6. Storage backends

`AccountStore` interface with an in-memory backend for dev/tests; Postgres is the
deploy adapter (same interface — `accounts(id, identity UNIQUE, auth_hash,
address, vault_ciphertext, kdf_params jsonb, iv, created_at, updated_at)`).

## 7. Configuration

| Env | Default | Notes |
|-----|---------|-------|
| `SESSION_SIGNING_KEY` | random (dev) | **required in production** |
| `ACCOUNT_PORT` | `8091` | |
| `SESSION_TTL_SECONDS` | `86400` | |
| `SECURE_COOKIES` | `true` | set `false` only for local http dev |
| `DATABASE_URL` | unset | Postgres adapter; unset → in-memory dev store |

Never log `authKey`, `vault_ciphertext`, the session token, or the password.

## 8. Out of scope (later hardening — #14)

Rate limiting, CSRF tokens, account lockout, email verification, key-rotation
governance, and KDF parameter tuning policy.

## 9. Run / verify

```bash
pnpm --filter @step/account-api dev    # env: SESSION_SIGNING_KEY
pnpm --filter @step/account-api test   # contract + zero-knowledge + crypto round-trip
```
