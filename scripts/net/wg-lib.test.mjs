import { test } from "node:test";
import assert from "node:assert/strict";
import { wgKeypair, hubEndpoints, hubPeerBlock, peerConfig } from "./wg-lib.mjs";

test("wgKeypair produces wg-format base64 32-byte keys", () => {
  const { privateKey, publicKey } = wgKeypair();
  for (const k of [privateKey, publicKey]) {
    assert.match(k, /^[A-Za-z0-9+/]{43}=$/); // base64 of 32 bytes
    assert.equal(Buffer.from(k, "base64").length, 32);
  }
  assert.notEqual(privateKey, publicKey);
  // distinct keypairs each call
  assert.notEqual(wgKeypair().privateKey, privateKey);
});

test("hubEndpoints derives RPC + artifact URLs from one host", () => {
  const e = hubEndpoints("tribecca.local");
  assert.equal(e.rpcUrl, "http://tribecca.local:8545");
  assert.equal(e.artifactBaseUrl, "http://tribecca.local:8078");
  assert.equal(hubEndpoints("10.50.0.1").rpcUrl, "http://10.50.0.1:8545");
  assert.throws(() => hubEndpoints(""));
  assert.throws(() => hubEndpoints("bad host"));
});

test("hubPeerBlock + peerConfig produce valid wg sections", () => {
  const peer = hubPeerBlock({ name: "vienna", publicKey: "PUB", address: "10.50.0.2" });
  assert.match(peer, /\[Peer\]/);
  assert.match(peer, /PublicKey = PUB/);
  assert.match(peer, /AllowedIPs = 10\.50\.0\.2\/32/);

  const cfg = peerConfig({
    privateKey: "PRIV",
    address: "10.50.0.2",
    hubPublicKey: "HUBPUB",
    hubEndpoint: "tribecca.example:51820",
    hubTunnelIp: "10.50.0.1",
  });
  assert.match(cfg, /\[Interface\]/);
  assert.match(cfg, /PrivateKey = PRIV/);
  assert.match(cfg, /Endpoint = tribecca\.example:51820/);
  assert.match(cfg, /AllowedIPs = 10\.50\.0\.1\/32/);
  assert.match(cfg, /PersistentKeepalive = 25/);
});
