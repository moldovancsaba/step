import { indexer } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function TreasuryPage() {
  interface TreasuryRow {
    total_twin_minted: string;
    withdrawals: { to: string; amount: string; purpose: string; tx_hash: string }[];
  }
  let treasury: TreasuryRow | null = null;
  try {
    treasury = (await indexer.treasury()) as TreasuryRow;
  } catch {
    /* indexer down */
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Foundation treasury</h1>
      <p className="max-w-2xl text-sm text-neutral-400">
        Every natural mint allocates a twin to the foundation treasury at the published
        rate (UNFROZEN parameter, currently 100% bootstrap — see the protocol parameter
        registry). All movements are reason-coded on-chain. No hidden transfers are
        possible (HARD §11.3).
      </p>
      {treasury ? (
        <>
          <div className="max-w-xs rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <div className="text-xs text-neutral-500">Lifetime twin Trinity</div>
            <div className="mt-1 text-2xl font-semibold">{treasury.total_twin_minted}</div>
          </div>
          <section>
            <h2 className="mb-2 text-lg font-medium">Withdrawals</h2>
            {treasury.withdrawals.length === 0 ? (
              <p className="text-sm text-neutral-500">No treasury withdrawals.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-neutral-500">
                  <tr>
                    <th className="py-2 pr-4 font-normal">To</th>
                    <th className="py-2 pr-4 font-normal">Amount</th>
                    <th className="py-2 pr-4 font-normal">Purpose code</th>
                    <th className="py-2 font-normal">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {treasury.withdrawals.map((w, i) => (
                    <tr key={i} className="border-t border-neutral-800">
                      <td className="py-2 pr-4 font-mono text-xs">{w.to}</td>
                      <td className="py-2 pr-4">{w.amount}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{w.purpose.slice(0, 18)}…</td>
                      <td className="py-2 font-mono text-xs">{w.tx_hash.slice(0, 10)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : (
        <p className="text-sm text-amber-300">Indexer unreachable.</p>
      )}
    </div>
  );
}
