export const dynamic = "force-dynamic";

const STATUS = [
  "None",
  "Pending review",
  "Approved",
  "Funded",
  "Active",
  "Paused",
  "Completed",
  "Rejected",
  "Expired",
  "Cancelled",
];

export default async function CampaignsPage() {
  const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:8090";
  let campaigns: {
    campaign_id: string;
    merchant: string;
    status: number;
    budget: string;
    released: string;
    refunded: string;
    verified_visits: number;
  }[] = [];
  try {
    campaigns = await (await fetch(`${indexerUrl}/v1/campaigns`, { cache: "no-store" })).json();
  } catch {
    /* indexer down */
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Your campaigns</h1>
      <p className="max-w-2xl text-sm text-neutral-600">
        Reporting is read straight from the chain via the indexer: verified visits,
        released budget, and refunds are exactly what the contracts recorded — there is no
        separate book.
      </p>
      {campaigns.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No campaigns indexed yet (or the indexer is unreachable).
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-4 font-normal">Campaign</th>
              <th className="py-2 pr-4 font-normal">Status</th>
              <th className="py-2 pr-4 font-normal">Verified visits</th>
              <th className="py-2 pr-4 font-normal">Budget</th>
              <th className="py-2 pr-4 font-normal">Released</th>
              <th className="py-2 font-normal">Refunded</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.campaign_id} className="border-t border-neutral-200">
                <td className="py-2 pr-4 font-mono text-xs">{c.campaign_id.slice(0, 12)}…</td>
                <td className="py-2 pr-4">{STATUS[c.status] ?? c.status}</td>
                <td className="py-2 pr-4">{c.verified_visits}</td>
                <td className="py-2 pr-4">{c.budget}</td>
                <td className="py-2 pr-4">{c.released}</td>
                <td className="py-2">{c.refunded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
