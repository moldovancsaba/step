/**
 * Server-side crypto for the account service. Two independent primitives:
 *
 *  - Auth verifier: the client already runs a memory-hard Argon2id KDF over the
 *    password to derive `authKey` — a high-entropy 256-bit secret; the password
 *    never leaves the browser. The server stores a salted HMAC-SHA256 of authKey
 *    as a verifier, so a DB leak does not reveal authKey (which, being
 *    high-entropy, is not brute-forceable). A fast keyed hash is sufficient here
 *    *because* the memory-hard cost is already paid client-side — and it keeps
 *    the verifier within edge/serverless CPU budgets (no per-request Argon2).
 *  - Session token: a compact HMAC-SHA256-signed token (`payloadB64.sigB64`),
 *    carried in an HTTP-only, Secure cookie. Stateless; short TTL; tamper- and
 *    expiry-checked on every request.
 *
 * No external/native dependencies: HMAC + random come from Node's crypto
 * (available on Cloudflare Workers via nodejs_compat).
 */
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

/** Salted HMAC-SHA256 of authKey (the per-row salt is the HMAC key). */
function macAuthKey(authKey: string, salt: Buffer): Buffer {
  return createHmac("sha256", salt).update(utf8(authKey)).digest();
}

/** Produce a salted verifier string `hmac-sha256$<saltB64>$<macB64>`. */
export function hashAuthKey(authKey: string): string {
  const salt = randomBytes(16);
  return `hmac-sha256$${b64(salt)}$${b64(macAuthKey(authKey, salt))}`;
}

/** Constant-time verify of an authKey against a stored verifier. */
export function verifyAuthKey(authKey: string, stored: string): boolean {
  const parts = stored.split("$");
  const [scheme, saltB64, macB64] = parts;
  if (parts.length !== 3 || scheme !== "hmac-sha256" || !saltB64 || !macB64) return false;
  const expected = Buffer.from(macB64, "base64");
  const actual = macAuthKey(authKey, Buffer.from(saltB64, "base64"));
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
