import { indexer, mesh } from "@/lib/api";
import { triangleIdHash } from "@step/shared-types";

export const dynamic = "force-dynamic";

export default async function TrianglePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);

  let geometry = null;
  try {
    geometry = await mesh.triangle(decoded);
  } catch {
    /* invalid id or mesh API down */
  }
  if (!geometry) {
    return <p className="text-sm text-amber-300">Unknown or unparseable triangle ID: {decoded}</p>;
  }

  const idHash = triangleIdHash(decoded);
  interface TriangleRow {
    used_slots: number;
    frozen: boolean;
    total_mined_trinity: string;
    oasis_campaigns: string[];
  }
  let state: TriangleRow | null = null;
  try {
    state = (await indexer.triangle(idHash)) as unknown as TriangleRow;
  } catch {
    /* never mined: no row is normal */
  }

  return (
    <div className="space-y-6">
      <h1 className="font-mono text-lg text-emerald-400">{decoded}</h1>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card label="Level" value={String(geometry.level)} />
        <Card
          label="Area"
          value={
            geometry.area_m2 > 1e6
              ? `${(geometry.area_m2 / 1e6).toFixed(1)} km²`
              : `${geometry.area_m2.toFixed(1)} m²`
          }
        />
        <Card label="Min side" value={`${geometry.min_side_m.toFixed(1)} m`} />
        <Card label="Slots used" value={state ? `${state.used_slots} / 27` : "0 / 27"} />
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
        <h2 className="mb-2 font-medium">Mining state</h2>
        {state ? (
          <dl className="grid grid-cols-2 gap-y-1 text-neutral-300">
            <dt className="text-neutral-500">Natural Trinity mined</dt>
            <dd>{state.total_mined_trinity}</dd>
            <dt className="text-neutral-500">Frozen</dt>
            <dd>{state.frozen ? "yes — restricted" : "no"}</dd>
            <dt className="text-neutral-500">Active oasis campaigns</dt>
            <dd>{state.oasis_campaigns.length}</dd>
          </dl>
        ) : (
          <p className="text-neutral-500">
            No on-chain activity yet — this triangle is untouched natural supply.
          </p>
        )}
        <p className="mt-3 font-mono text-xs text-neutral-600">on-chain id: {idHash}</p>
      </section>

      <section className="text-sm">
        <h2 className="mb-2 font-medium">Hierarchy</h2>
        <p className="text-neutral-400">
          Parent:{" "}
          {geometry.parent ? (
            <a className="font-mono text-emerald-400 hover:underline" href={`/triangle/${geometry.parent}`}>
              {geometry.parent}
            </a>
          ) : (
            "base face"
          )}
        </p>
        <p className="mt-1 text-neutral-400">
          Neighbours:{" "}
          {geometry.neighbours.map((n) => (
            <a key={n} className="mr-2 font-mono text-xs text-emerald-400 hover:underline" href={`/triangle/${n}`}>
              {n}
            </a>
          ))}
        </p>
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
