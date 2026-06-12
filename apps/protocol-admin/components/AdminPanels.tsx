"use client";

import { useState } from "react";
import {
  freezeTriangle,
  moderateCampaign,
  reviewMerchant,
  setEmergencyPause,
  type ActionResult,
} from "@/lib/actions";

const input =
  "mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:border-red-500 focus:outline-none";
const label = "block text-sm text-neutral-300";
const button =
  "mt-3 rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

function Notice({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      className={`mt-3 rounded p-3 text-xs ${
        result.ok ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"
      }`}
    >
      {result.message}
    </p>
  );
}

export function AdminPanels() {
  const [merchant, setMerchant] = useState<ActionResult | null>(null);
  const [campaign, setCampaign] = useState<ActionResult | null>(null);
  const [safety, setSafety] = useState<ActionResult | null>(null);
  const [pause, setPause] = useState<ActionResult | null>(null);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="font-medium">Merchant approval (MER-001)</h2>
        <form action={async (fd) => setMerchant(await reviewMerchant(fd))}>
          <label className={label}>
            Merchant ID
            <input name="merchant_id" required className={input} placeholder="mer_1" />
          </label>
          <div className="mt-3 flex gap-3">
            <button name="decision" value="approve" className={`${button} bg-emerald-700 hover:bg-emerald-800`}>
              Approve
            </button>
            <button name="decision" value="reject" className={`${button} bg-neutral-700 hover:bg-neutral-600`}>
              Reject
            </button>
          </div>
        </form>
        <Notice result={merchant} />
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="font-medium">Campaign moderation (on-chain)</h2>
        <form action={async (fd) => setCampaign(await moderateCampaign(fd))}>
          <label className={label}>
            Campaign ID
            <input name="campaign_id" required className={`${input} font-mono text-xs`} placeholder="0x…" />
          </label>
          <div className="mt-3 flex gap-3">
            <button name="decision" value="approve" className={`${button} bg-emerald-700 hover:bg-emerald-800`}>
              Approve
            </button>
            <button name="decision" value="reject" className={`${button} bg-neutral-700 hover:bg-neutral-600`}>
              Reject
            </button>
          </div>
        </form>
        <Notice result={campaign} />
      </section>

      <section className="rounded-lg border border-red-900/50 bg-red-950/20 p-5">
        <h2 className="font-medium text-red-300">Safety: triangle freeze (SAF-003/004)</h2>
        <form action={async (fd) => setSafety(await freezeTriangle(fd))}>
          <label className={label}>
            Triangle ID hash
            <input name="triangle_id_hash" required className={`${input} font-mono text-xs`} placeholder="0x…" />
          </label>
          <label className={`${label} mt-3`}>
            Reason code
            <select name="reason" className={input} defaultValue="SAFETY_REVIEW">
              <option>SAFETY_REVIEW</option>
              <option>SAFETY_MILITARY</option>
              <option>SAFETY_AIRPORT</option>
              <option>SAFETY_RAILWAY</option>
              <option>SAFETY_SCHOOL</option>
              <option>SAFETY_HOSPITAL</option>
              <option>SAFETY_DANGEROUS_TERRAIN</option>
              <option>FRAUD_REVIEW</option>
              <option>LEGAL_REVIEW</option>
            </select>
          </label>
          <div className="mt-3 flex gap-3">
            <button name="decision" value="freeze" className={`${button} bg-red-700 hover:bg-red-800`}>
              Freeze NOW
            </button>
            <button name="decision" value="unfreeze" className={`${button} bg-neutral-700 hover:bg-neutral-600`}>
              Unfreeze
            </button>
          </div>
        </form>
        <Notice result={safety} />
      </section>

      <section className="rounded-lg border border-red-900/50 bg-red-950/20 p-5">
        <h2 className="font-medium text-red-300">Emergency pause (HARD §11.4)</h2>
        <p className="mt-1 text-xs text-neutral-400">
          Domain-scoped circuit breakers. All pauses emit public events; use for exploits,
          legal stops, or incident drills only.
        </p>
        <form action={async (fd) => setPause(await setEmergencyPause(fd))}>
          <label className={label}>
            Domain
            <select name="domain" className={input} defaultValue="PAUSE_MINTING">
              <option value="PAUSE_MINTING">PAUSE_MINTING — all natural mints</option>
              <option value="PAUSE_CAMPAIGNS">PAUSE_CAMPAIGNS — oasis funding/claims</option>
            </select>
          </label>
          <div className="mt-3 flex gap-3">
            <button name="decision" value="pause" className={`${button} bg-red-700 hover:bg-red-800`}>
              PAUSE
            </button>
            <button name="decision" value="resume" className={`${button} bg-neutral-700 hover:bg-neutral-600`}>
              Resume
            </button>
          </div>
        </form>
        <Notice result={pause} />
      </section>
    </div>
  );
}
