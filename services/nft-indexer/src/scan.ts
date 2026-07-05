/**
 * Plan bounded block-scan windows. A large gap between the last indexed block
 * and chain head must be fetched in provider-safe chunks — cosmos-EVM caps
 * eth_getLogs at ~10k blocks, so a single unbounded getLogs would throw and
 * stall indexing. Mirrors the bounded loop in services/indexer.
 */
export function scanWindows(from: bigint, head: bigint, maxRange: bigint): [bigint, bigint][] {
  if (maxRange <= 0n) throw new Error("maxRange must be a positive block count");
  const windows: [bigint, bigint][] = [];
  let f = from;
  while (f <= head) {
    const to = f + maxRange - 1n < head ? f + maxRange - 1n : head;
    windows.push([f, to]);
    f = to + 1n;
  }
  return windows;
}
