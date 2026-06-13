import { indexer } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  interface ClaimRow {
    claim_hash: string;
    triangle_id_hash: string;
    miner: string;
    kind: string;
    slot: number | null;
    campaign_id: string | null;
    trinity_amount: string;
    block_number: string;
    tx_hash: string;
  }
  let claim: ClaimRow | null = null;
  try {
    claim = (await indexer.claim(hash as `0x${string}`)) as ClaimRow;
  } catch {
    /* not found */
  }

  if (!claim) {
    return (
      <p className="text-sm text-neutral-400">
        Claim {hash} is not finalised on-chain (or the indexer has not seen it yet).
        Pending/rejected claims are visible to the miner in the app, never published here.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-lg text-emerald-400 break-all">{claim.claim_hash}</h1>
      <dl className="grid max-w-xl grid-cols-[12rem_1fr] gap-y-2 text-sm text-neutral-300">
        <dt className="text-neutral-500">Kind</dt>
        <dd>{claim.kind === "natural" ? "Natural mining" : "Sponsored oasis"}</dd>
        <dt className="text-neutral-500">Miner</dt>
        <dd className="font-mono text-xs">{claim.miner}</dd>
        <dt className="text-neutral-500">Triangle (hash)</dt>
        <dd className="font-mono text-xs break-all">{claim.triangle_id_hash}</dd>
        {claim.slot !== null && (
          <>
            <dt className="text-neutral-500">Collector slot</dt>
            <dd>{claim.slot}</dd>
          </>
        )}
        {claim.campaign_id && (
          <>
            <dt className="text-neutral-500">Campaign</dt>
            <dd className="font-mono text-xs break-all">{claim.campaign_id}</dd>
          </>
        )}
        <dt className="text-neutral-500">Trinity</dt>
        <dd>{claim.trinity_amount}</dd>
        <dt className="text-neutral-500">Block</dt>
        <dd>{claim.block_number}</dd>
        <dt className="text-neutral-500">Transaction</dt>
        <dd className="font-mono text-xs break-all">{claim.tx_hash}</dd>
      </dl>
      <p className="max-w-xl text-xs text-neutral-500">
        Privacy note (PRV-001): the chain holds only this hash-level record. Raw location
        evidence lives encrypted off-chain and is accessible solely to foundation claim
        review under the retention policy.
      </p>
    </div>
  );
}
