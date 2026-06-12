/**
 * Weighted quorum aggregation (VAL-002): pure logic, fully unit-tested.
 * The contract re-verifies everything — this is the gateway's pre-check so it
 * never wastes gas on a claim that cannot pass.
 */
import type { Address, SignedVote } from "@step/shared-types";

export interface WeightedVote {
  vote: SignedVote;
  weight: bigint;
}

export interface QuorumResult {
  reached: boolean;
  totalWeight: bigint;
  /** Approval votes sorted by validator address ascending — the exact order
   *  MiningClaimVerifier requires (cheap on-chain dedup). */
  sortedApprovals: SignedVote[];
}

export function aggregateQuorum(
  votes: WeightedVote[],
  thresholdWeight: bigint,
): QuorumResult {
  const approvals = new Map<string, WeightedVote>();
  for (const wv of votes) {
    if (!wv.vote.approve || wv.weight <= 0n) continue;
    // Last vote per validator wins; duplicates collapse.
    approvals.set(wv.vote.validator.toLowerCase(), wv);
  }
  const sorted = [...approvals.values()].sort((a, b) => {
    const x = BigInt(a.vote.validator);
    const y = BigInt(b.vote.validator);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const totalWeight = sorted.reduce((acc, wv) => acc + wv.weight, 0n);
  return {
    reached: totalWeight >= thresholdWeight,
    totalWeight,
    sortedApprovals: sorted.map((wv) => wv.vote),
  };
}

/** All votes must agree on the same claim identity before aggregation. */
export function votesAreConsistent(
  votes: SignedVote[],
  claimHash: string,
  miner: Address,
): boolean {
  return votes.every(
    (v) =>
      v.claim_hash.toLowerCase() === claimHash.toLowerCase() &&
      v.miner.toLowerCase() === miner.toLowerCase(),
  );
}
