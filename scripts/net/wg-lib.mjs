/**
 * Self-hosted WireGuard helpers (#48) — pure, testable. Lets a trust center in a
 * different location reach the hub over a tunnel WE control (our keys, no Tailscale
 * coordination server, no SaaS). Same-LAN nodes don't need this at all (they use
 * mDNS `tribecca.local` or a reserved IP).
 *
 * WireGuard keys are Curve25519; Node's built-in X25519 keygen produces exactly
 * that, so no `wg` tool is needed to GENERATE keys (you still install
 * wireguard-tools to RUN the tunnel).
 */
import { generateKeyPairSync } from "node:crypto";

/** A WireGuard Curve25519 keypair as base64 (the `wg`-compatible format). */
export function wgKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  // The raw 32-byte key is the trailing 32 bytes of the DER encoding.
  return {
    privateKey: Buffer.from(privDer.subarray(privDer.length - 32)).toString("base64"),
    publicKey: Buffer.from(pubDer.subarray(pubDer.length - 32)).toString("base64"),
  };
}

/** Derive the hub's RPC + artifact endpoints from a single host (name or IP). */
export function hubEndpoints(host, { rpcPort = 8545, artifactPort = 8078 } = {}) {
  if (!host || /\s/.test(host)) throw new Error(`invalid hub host: ${JSON.stringify(host)}`);
  return {
    host,
    rpcUrl: `http://${host}:${rpcPort}`,
    artifactBaseUrl: `http://${host}:${artifactPort}`,
  };
}

/** The hub-side `[Peer]` block to append to the hub's wg0.conf for a node. */
export function hubPeerBlock({ name, publicKey, address }) {
  return [
    `# ${name}`,
    `[Peer]`,
    `PublicKey = ${publicKey}`,
    `AllowedIPs = ${address}/32`,
    ``,
  ].join("\n");
}

/** The node's wg0.conf (its [Interface] + the hub as a [Peer]). */
export function peerConfig({
  privateKey,
  address,
  hubPublicKey,
  hubEndpoint,
  hubTunnelIp,
  keepalive = 25,
}) {
  return [
    `[Interface]`,
    `PrivateKey = ${privateKey}`,
    `Address = ${address}/32`,
    ``,
    `[Peer]`,
    `# STEP hub`,
    `PublicKey = ${hubPublicKey}`,
    `Endpoint = ${hubEndpoint}`,
    `AllowedIPs = ${hubTunnelIp}/32`,
    `PersistentKeepalive = ${keepalive}`,
    ``,
  ].join("\n");
}
