/**
 * Campaign expiry/settlement decisions (OAS-005 expiry + unused-funds rules).
 * Pure functions over chain state — the chain is the only state this worker
 * needs, so no queue infrastructure is required in alpha (ADR-013 revision:
 * BullMQ/Redis arrives with notification fan-out and retention jobs at MVP).
 */

/** CampaignRegistry.CampaignStatus enum mirror. */
export const CampaignStatus = {
  None: 0,
  PendingReview: 1,
  Approved: 2,
  Funded: 3,
  Active: 4,
  Paused: 5,
  Completed: 6,
  Rejected: 7,
  Expired: 8,
  Cancelled: 9,
} as const;

export interface CampaignChainState {
  status: number;
  endsAt: bigint;
  budget: bigint;
  released: bigint;
  refunded: bigint;
}

/** expireCampaign() is callable once a Funded/Active/Paused campaign passes endsAt. */
export function shouldExpire(c: CampaignChainState, nowUnix: bigint): boolean {
  const expirable =
    c.status === CampaignStatus.Funded ||
    c.status === CampaignStatus.Active ||
    c.status === CampaignStatus.Paused;
  return expirable && nowUnix >= c.endsAt;
}

/** refund() settles remaining funds of terminal campaigns per policy. */
export function shouldRefund(c: CampaignChainState): boolean {
  const terminal =
    c.status === CampaignStatus.Expired ||
    c.status === CampaignStatus.Cancelled ||
    c.status === CampaignStatus.Rejected ||
    c.status === CampaignStatus.Completed;
  return terminal && c.budget - c.released - c.refunded > 0n;
}
