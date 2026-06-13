import Link from "next/link";
import { indexer } from "@/lib/api";

export const dynamic = "force-dynamic";

async function getStats() {
  try {
    return await indexer.stats();
  } catch {
    return null;
  }
}

async function getRecentClaims() {
  try {
    return (await indexer.claims()) as {
      claim_hash: string;
      miner: string;
      kind: string;
      trinity_amount: string;
      block_number: string;
    }[];
  } catch {
    return [];
  }
}

export default async function Home() {
  const [stats, claims] = await Promise.all([getStats(), getRecentClaims()]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold">Proof-of-presence, verifiable by anyone</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          The Earth is divided into a deterministic spherical triangular MESH. Miners earn
          Trinity by proving physical presence inside a triangle; businesses fund Trinity
          oases that reward verified visits. This dashboard shows everything the chain
          knows — and nothing it must not (no coordinates are ever on-chain).
        </p>
      </section>

      {stats ? (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Total Trinity supply" value={stats.total_supply} />
          <Stat label="Claims finalised" value={String(stats.claims_finalised)} />
          <Stat label="Sponsored visits" value={String(stats.sponsored_claims)} />
          <Stat label="Triangles touched" value={String(stats.triangles_touched)} />
        </section>
      ) : (
        <p className="rounded border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-300">
          Indexer unreachable at the configured NEXT_PUBLIC_INDEXER_URL — start the local
          stack (see README quick start) to see live data.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium">Recent claims</h2>
        {claims.length === 0 ? (
          <p className="text-sm text-neutral-500">No finalised claims yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-2 pr-4 font-normal">Claim</th>
                <th className="py-2 pr-4 font-normal">Miner</th>
                <th className="py-2 pr-4 font-normal">Kind</th>
                <th className="py-2 pr-4 font-normal">Trinity</th>
                <th className="py-2 font-normal">Block</th>
              </tr>
            </thead>
            <tbody>
              {claims.slice(0, 20).map((c) => (
                <tr key={c.claim_hash} className="border-t border-neutral-800">
                  <td className="py-2 pr-4 font-mono text-xs">
                    <Link className="text-emerald-400 hover:underline" href={`/claim/${c.claim_hash}`}>
                      {c.claim_hash.slice(0, 10)}…{c.claim_hash.slice(-6)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{c.miner.slice(0, 10)}…</td>
                  <td className="py-2 pr-4">{c.kind}</td>
                  <td className="py-2 pr-4">{c.trinity_amount}</td>
                  <td className="py-2">{c.block_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold">{value}</div>
    </div>
  );
}
