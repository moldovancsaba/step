import { describe, expect, it } from "vitest";
import { CampaignStatus, shouldExpire, shouldRefund } from "../src/expiry.js";

const base = { endsAt: 1000n, budget: 500n, released: 100n, refunded: 0n };

describe("expiry decisions (OAS-005)", () => {
  it("expires Funded/Active/Paused past endsAt only", () => {
    for (const status of [CampaignStatus.Funded, CampaignStatus.Active, CampaignStatus.Paused]) {
      expect(shouldExpire({ ...base, status }, 1000n)).toBe(true);
      expect(shouldExpire({ ...base, status }, 999n)).toBe(false);
    }
    for (const status of [
      CampaignStatus.PendingReview,
      CampaignStatus.Approved,
      CampaignStatus.Completed,
      CampaignStatus.Expired,
      CampaignStatus.Cancelled,
      CampaignStatus.Rejected,
    ]) {
      expect(shouldExpire({ ...base, status }, 2000n)).toBe(false);
    }
  });

  it("refunds only terminal campaigns with remaining budget", () => {
    expect(shouldRefund({ ...base, status: CampaignStatus.Expired })).toBe(true);
    expect(shouldRefund({ ...base, status: CampaignStatus.Cancelled })).toBe(true);
    expect(shouldRefund({ ...base, status: CampaignStatus.Completed })).toBe(true);
    expect(shouldRefund({ ...base, status: CampaignStatus.Active })).toBe(false);
    // Fully settled: nothing left.
    expect(
      shouldRefund({ status: CampaignStatus.Expired, endsAt: 0n, budget: 500n, released: 100n, refunded: 400n }),
    ).toBe(false);
  });
});
