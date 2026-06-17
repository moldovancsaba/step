/**
 * Server-side crypto for the account service. Two independent primitives:
 *
 *  - Auth verifier: the client already runs a memory-hard Argon2id KDF over the
 *    password to derive `authKey` (high-entropy, the password never leaves the
 *    browser). The server stores Argon2id(authKey + per-row salt) as a verifier
 *    so a DB leak does not reveal authKey. Defense-in-depth, not the primary
 *    KDF (that is client-side).
 *  - Session token: a compact HMAC-SHA256-signed token (`payloadB64.sigB64`),
 *    carried in an HTTP-only, Secure, SameSite=strict cookie. Stateless; short
 *    TTL; tamper- and expiry-checked on every request.
 *
 * No external/native dependencies: Argon2id comes from the audited pure-JS
 * @noble/hashes; HMAC + random come from Node's crypto.
 */
import { argon2id } from "@noble/hashes/argon2";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const b64url = (b: Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? utf8(b) : b)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// Server-side verifier params: modest (authKey is already high-entropy from the
// client KDF). Tuned to ~tens of ms; the heavy memory-hard cost is client-side.
const VERIFY_PARAMS = { m: 19_456, t: 2, p: 1, dkLen: 32 } as const;

/** Produce a salted Argon2id verifier string `argon2id$<saltB64>$<hashB64>`. */
export function hashAuthKey(authKey: string): string {
  const salt = randomBytes(16);
  const hash = argon2id(utf8(authKey), salt, VERIFY_PARAMS);
  return `argon2id$${b64(salt)}$${b64(hash)}`;
}

/** Constant-time verify of an authKey against a stored verifier. */
export function verifyAuthKey(authKey: string, stored: string): boolean {
  const parts = stored.split("$");
  const [scheme, saltB64, hashB64] = parts;
  if (parts.length !== 3 || scheme !== "argon2id" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = Buffer.from(argon2id(utf8(authKey), salt, VERIFY_PARAMS));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface SessionClaims {
  identity: string;
  address: `0x${string}`;
  exp: number; // unix seconds
}

/** Sign session claims into a compact `payload.sig` token. */
export function signSession(claims: SessionClaims, secret: string): string {
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Verify a session token: signature, structure, and expiry. */
export function verifySession(
  token: string,
  secret: string,
  nowUnix: number,
): SessionClaims | undefined {
  const dot = token.indexOf(".");
  if (dot < 0) return undefined;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(payload).digest());
  const a = utf8(sig);
  const b = utf8(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as SessionClaims;
    if (typeof claims.exp !== "number" || claims.exp <= nowUnix) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}
