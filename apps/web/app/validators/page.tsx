import { indexer } from "@/lib/api";

export const dynamic = "force-dynamic";

const TYPE_NAMES = ["Mobile peer", "Approved point", "Merchant", "Venue", "Infrastructure", "Protocol"];
const STATUS_NAMES = ["Unregistered", "Active", "Under review", "Suspended", "Removed"];

export default async function ValidatorsPage() {
  let validators: {
    validator: string;
    validator_type: number;
    weight: string;
    status: number;
    slashed_total: string;
  }[] = [];
  try {
    validators = (await indexer.validators()) as typeof validators;
  } catch {
    /* indexer down */
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Validators</h1>
      <p className="max-w-2xl text-sm text-neutral-400">
        Claims finalise only with a weighted quorum of validator signatures (never a simple
        majority of anonymous devices). The alpha runs a closed, foundation-approved set;
        open registration follows once fraud rules are field-proven (DEV §9.5).
      </p>
      {validators.length === 0 ? (
        <p className="text-sm text-neutral-500">No validators indexed yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-500">
            <tr>
              <th className="py-2 pr-4 font-normal">Address</th>
              <th className="py-2 pr-4 font-normal">Type</th>
              <th className="py-2 pr-4 font-normal">Weight</th>
              <th className="py-2 pr-4 font-normal">Status</th>
              <th className="py-2 font-normal">Slashed</th>
            </tr>
          </thead>
          <tbody>
            {validators.map((v) => (
              <tr key={v.validator} className="border-t border-neutral-800">
                <td className="py-2 pr-4 font-mono text-xs">{v.validator}</td>
                <td className="py-2 pr-4">{TYPE_NAMES[v.validator_type] ?? v.validator_type}</td>
                <td className="py-2 pr-4">{v.weight}</td>
                <td className="py-2 pr-4">{STATUS_NAMES[v.status] ?? v.status}</td>
                <td className="py-2">{v.slashed_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
