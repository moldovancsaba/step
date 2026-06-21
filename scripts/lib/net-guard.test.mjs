import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost, assertSafeHosts } from "./net-guard.mjs";

test("loopback / RFC1918 / WireGuard are private", () => {
  for (const h of ["127.0.0.1", "localhost", "::1", "10.0.0.5", "192.168.100.64", "172.16.4.4", "172.31.0.1", "10.50.0.1"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test("0.0.0.0, public IPs, and hostnames are NOT private (fail closed)", () => {
  for (const h of ["0.0.0.0", "::", "8.8.8.8", "1.2.3.4", "172.32.0.1", "192.169.0.1", "rpc.example.com", ""]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test("assertSafeHosts throws on a public host without override", () => {
  assert.throws(() => assertSafeHosts(["127.0.0.1", "0.0.0.0"]), /non-private/);
  assert.doesNotThrow(() => assertSafeHosts(["127.0.0.1", "192.168.1.2"]));
});

test("override downgrades to a warning", () => {
  let warned = "";
  const out = assertSafeHosts(["8.8.8.8"], { allowPublic: true, warn: (m) => (warned = m) });
  assert.deepEqual(out, ["8.8.8.8"]);
  assert.match(warned, /WARNING/);
});
