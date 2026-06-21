/**
 * net-guard (#62) — default-deny public exposure of a public-key chain.
 *
 * The dev `anvil` is funded by the well-known Hardhat account-0 key, so anyone who
 * can reach its RPC controls it. This refuses to bind it to a public interface
 * (or `0.0.0.0`, which binds ALL interfaces incl. public) unless the operator
 * explicitly opts in. Loopback, RFC1918 LAN, and the federation WireGuard range
 * are allowed.
 */

/** WireGuard tunnel range used by the federation (scripts/net/wg-gen.mjs: 10.50.0.0/24). */
const WG_PREFIX = "10.50.0.";

/** True for loopback / RFC1918 / the WG range. `0.0.0.0` and `::` are NOT private. */
export function isPrivateHost(host) {
  const h = String(host).trim().toLowerCase();
  if (h === "0.0.0.0" || h === "::" || h === "") return false; // all-interfaces ⇒ public
  if (h === "127.0.0.1" || h === "localhost" || h === "::1") return true;
  if (h.startsWith(WG_PREFIX)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // hostname or non-IPv4 literal ⇒ treat as public (fail closed)
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // 127/8
  if (a === 10) return true; // 10/8
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  return false;
}

/**
 * Throw unless every host is private. `allowPublic` (operator opt-in) downgrades
 * the throw to a loud warning. Returns the hosts unchanged on success.
 */
export function assertSafeHosts(hosts, { allowPublic = false, warn = console.error } = {}) {
  const bad = hosts.filter((h) => !isPrivateHost(h));
  if (bad.length === 0) return hosts;
  const msg =
    `refusing to expose the public-key dev chain on non-private host(s): ${bad.join(", ")}. ` +
    `Use loopback/LAN/WireGuard, or set STEP_ALLOW_PUBLIC_ANVIL=1 to override (NOT recommended).`;
  if (!allowPublic) {
    throw new Error(msg);
  }
  warn(`[net-guard] WARNING (STEP_ALLOW_PUBLIC_ANVIL): ${msg}`);
  return hosts;
}
