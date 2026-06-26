/**
 * Shared release helpers: the canonical sha256 + semver packing used by the
 * publisher (this dir) and mirrored by the Rust agent's verification. Pure +
 * unit-tested so the hash an operator publishes is exactly what a node checks.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";

/** Streamed sha256 of a file → `0x`-prefixed lowercase hex (bounded memory). */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(`0x${h.digest("hex")}`))
      .on("error", reject);
  });
}

/** sha256 of a buffer/string → `0x`-hex. */
export function sha256Bytes(buf) {
  return `0x${createHash("sha256").update(buf).digest("hex")}`;
}

export function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

export function chunkFile(path, chunkSize = 1024 * 1024) {
  const bytes = readFileSync(path);
  const chunks = [];
  for (let offset = 0, index = 0; offset < bytes.length; offset += chunkSize, index += 1) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    chunks.push({
      index,
      offset,
      size: chunk.length,
      sha256: sha256Bytes(chunk),
    });
  }
  const rootInput = chunks.map((c) => c.sha256.slice(2)).join("");
  return {
    chunkSize,
    totalSize: bytes.length,
    chunks,
    chunkRoot: sha256Bytes(Buffer.from(rootInput, "hex")),
  };
}

/** Pack `major.minor.patch` into a uint64 `(major<<32)|(minor<<16)|patch` (BigInt). */
export function packSemver(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s).trim());
  if (!m) throw new Error(`invalid semver: ${s}`);
  const [major, minor, patch] = [BigInt(m[1]), BigInt(m[2]), BigInt(m[3])];
  if (minor > 0xffffn || patch > 0xffffn || major > 0xffffffffn) {
    throw new Error(`semver component out of range: ${s}`);
  }
  return (major << 32n) | (minor << 16n) | patch;
}

/** Inverse of {@link packSemver}. */
export function formatSemver(v) {
  const n = BigInt(v);
  return `${n >> 32n}.${(n >> 16n) & 0xffffn}.${n & 0xffffn}`;
}
