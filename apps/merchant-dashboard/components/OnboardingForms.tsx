"use client";

/**
 * Merchant onboarding flow (MER-001): register → (foundation approves) →
 * create POI → create campaign → fund & activate. Client component wrapping
 * the server actions with progressive state.
 */
import { useState } from "react";
import {
  createCampaign,
  createPoi,
  fundAndActivate,
  registerMerchant,
  type ActionResult,
} from "@/lib/actions";

function Notice({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      className={`mt-3 rounded p-3 text-sm ${
        result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
      }`}
    >
      {result.message}
    </p>
  );
}

const input =
  "mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none";
const label = "block text-sm font-medium text-neutral-700";
const button =
  "mt-4 rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50";

export function OnboardingForms() {
  const [reg, setReg] = useState<ActionResult | null>(null);
  const [poi, setPoi] = useState<ActionResult | null>(null);
  const [campaign, setCampaign] = useState<ActionResult | null>(null);
  const [funding, setFunding] = useState<ActionResult | null>(null);

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-medium">1 · Register your business</h2>
        <form action={async (fd) => setReg(await registerMerchant(fd))}>
          <label className={label}>
            Business name
            <input name="name" required className={input} placeholder="Café Mesh" />
          </label>
          <label className={`${label} mt-3`}>
            Category
            <select name="category" className={input} defaultValue="horeca">
              <option value="horeca">Café / restaurant</option>
              <option value="retail">Retail</option>
              <option value="services">Services</option>
              <option value="events">Events / venue</option>
              <option value="tourism">Tourism</option>
            </select>
          </label>
          <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
            <input type="checkbox" name="rights_confirmed" required className="mt-1" />
            <span>
              I confirm I control or have rights to the campaign location, visitors can
              legally and safely access it, and my offer complies with applicable law.
            </span>
          </label>
          <button className={button}>Register (goes to foundation review)</button>
        </form>
        <Notice result={reg} />
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-medium">2 · Add your point of interest</h2>
        <p className="mt-1 text-xs text-neutral-500">
          After approval. Coordinates are mapped to the canonical MESH triangle at the
          street level (≈7 m).
        </p>
        <form action={async (fd) => setPoi(await createPoi(fd))}>
          <label className={label}>
            Merchant ID
            <input
              name="merchant_id"
              required
              className={input}
              defaultValue={reg?.data?.merchant_id ?? ""}
              placeholder="mer_1"
            />
          </label>
          <label className={`${label} mt-3`}>
            POI name
            <input name="name" required className={input} placeholder="Front door" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className={label}>
              Latitude
              <input name="lat" required type="number" step="any" className={input} placeholder="47.4979" />
            </label>
            <label className={label}>
              Longitude
              <input name="lon" required type="number" step="any" className={input} placeholder="19.0402" />
            </label>
          </div>
          <button className={button}>Create POI</button>
        </form>
        <Notice result={poi} />
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-medium">3 · Create a front-door oasis</h2>
        <form action={async (fd) => setCampaign(await createCampaign(fd))}>
          <label className={label}>
            POI triangle hash
            <input
              name="triangle_id_hash"
              required
              className={`${input} font-mono text-xs`}
              defaultValue={poi?.data?.triangle_id_hash ?? ""}
              placeholder="0x…"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className={label}>
              Trinity per visit
              <input name="reward_per_claim" required type="number" min="1" className={input} defaultValue="100000" />
            </label>
            <label className={label}>
              Duration (days)
              <input name="duration_days" required type="number" min="1" max="92" className={input} defaultValue="7" />
            </label>
          </div>
          <button className={button}>Create campaign (on-chain)</button>
        </form>
        <Notice result={campaign} />
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="font-medium">4 · Fund & activate (after approval)</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Pre-funding is mandatory: your oasis goes live only with a locked budget, and the
          budget releases exclusively against accepted proofs.
        </p>
        <form action={async (fd) => setFunding(await fundAndActivate(fd))}>
          <label className={label}>
            Campaign ID
            <input
              name="campaign_id"
              required
              className={`${input} font-mono text-xs`}
              defaultValue={campaign?.data?.campaign_id ?? ""}
              placeholder="0x…"
            />
          </label>
          <label className={`${label} mt-3`}>
            Budget (Trinity)
            <input name="budget_trinity" required type="number" min="1" className={input} defaultValue="500000" />
          </label>
          <button className={button}>Fund & activate</button>
        </form>
        <Notice result={funding} />
      </section>
    </div>
  );
}
