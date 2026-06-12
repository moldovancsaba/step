/**
 * Server-side data access for the explorer. URLs come from env so the same
 * build serves local dev and the pilot deployment (ENG-001 config-driven).
 */
import { indexerClient, meshClient } from "@step/api-client";

export const INDEXER_URL =
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://127.0.0.1:8090";
export const MESH_API_URL =
  process.env.NEXT_PUBLIC_MESH_API_URL ?? "http://127.0.0.1:9100";

export const indexer = indexerClient(INDEXER_URL);
export const mesh = meshClient(MESH_API_URL);

/** MESH state colours (SYS §7.6 / HARD §10.4 display states). */
export function triangleStateColor(t: {
  frozen: boolean;
  used_slots: number;
  oasis_campaigns: unknown[];
  totalSlots?: number;
}): { color: string; label: string } {
  const slots = t.totalSlots ?? 27;
  if (t.frozen) return { color: "#dc2626", label: "Restricted" };
  if (t.oasis_campaigns.length > 0) return { color: "#2563eb", label: "Trinity Oasis" };
  if (t.used_slots >= slots) return { color: "#171717", label: "Trinity Desert" };
  if (t.used_slots > slots / 2) return { color: "#525252", label: "Low yield" };
  if (t.used_slots > 0) return { color: "#a3a3a3", label: "Partially mined" };
  return { color: "#fafafa", label: "Untouched" };
}
