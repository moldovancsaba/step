import { readFileSync } from "node:fs";
import { AdminPanels } from "@/components/AdminPanels";

export const dynamic = "force-dynamic";

function loadParams() {
  try {
    return JSON.parse(
      readFileSync(process.env.STEP_PROTOCOL_PARAMS ?? "../../config/protocol-params.alpha.json", "utf8"),
    );
  } catch {
    return null;
  }
}

export default function AdminHome() {
  const params = loadParams();
  return (
    <div className="space-y-10">
      <AdminPanels />

      <section>
        <h2 className="mb-3 text-lg font-medium">Protocol parameter registry</h2>
        <p className="mb-3 max-w-2xl text-sm text-neutral-400">
          Economic constants are governed, time-locked parameters — values marked UNFROZEN
          are working defaults pending the tokenomics constitution, not decisions
          (ADR-003/007/008). Changes go through schedule → delay → apply on-chain.
        </p>
        {params ? (
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900 text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-normal">Group</th>
                  <th className="px-3 py-2 font-normal">Parameter</th>
                  <th className="px-3 py-2 font-normal">Value</th>
                  <th className="px-3 py-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(params)
                  .filter(([k]) => !k.startsWith("$") && k !== "registry_version")
                  .flatMap(([group, entries]) =>
                    Object.entries(entries as Record<string, { value: unknown; status?: string }>).map(
                      ([key, entry]) => (
                        <tr key={`${group}.${key}`} className="border-t border-neutral-800">
                          <td className="px-3 py-2 text-neutral-500">{group}</td>
                          <td className="px-3 py-2 font-mono text-xs">{key}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {JSON.stringify(entry.value)}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${
                                entry.status?.startsWith("FROZEN")
                                  ? "bg-emerald-900/50 text-emerald-300"
                                  : "bg-amber-900/50 text-amber-300"
                              }`}
                            >
                              {entry.status ?? "—"}
                            </span>
                          </td>
                        </tr>
                      ),
                    ),
                  )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-amber-300">Parameter registry not found.</p>
        )}
      </section>
    </div>
  );
}
