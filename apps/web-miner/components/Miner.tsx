"use client";

/**
 * Browser miner — the Apple-independent path to actually using the platform.
 *
 * Self-custody: a secp256k1 key is generated in the browser and kept in
 * localStorage (device-local). The miner:
 *   1. reads the device location (navigator.geolocation),
 *   2. resolves the canonical triangle (via /api/resolve → mesh engine),
 *   3. requests a nonce, builds + SIGNS the claim locally (@step/proof-protocol),
 *   4. submits it (/api/submit → gateway → validators → chain),
 *   5. polls status and shows the Trinity balance.
 *
 * The signed bytes are byte-identical to the iOS app and the validators —
 * this is the same protocol, just a browser client. Claims are
 * integrity_mode "dev-unattested": a development path (pilot iPhone claims add
 * App Attest). Trinity is valueless testnet currency.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { buildUnsignedClaim, signClaim } from "@step/proof-protocol";

interface TriangleInfo {
  triangle_id: string;
  level: number;
  min_side_m: number;
  area_m2: number;
}
interface ClaimRecord {
  claim_hash: string;
  status: string;
  reject_reasons: string[];
  tx_hash?: string;
}

const KEY_STORAGE = "step.miner.pk.v1";

function loadOrCreateKey(): Hex {
  if (typeof window === "undefined") return generatePrivateKey();
  const existing = window.localStorage.getItem(KEY_STORAGE) as Hex | null;
  if (existing) return existing;
  const pk = generatePrivateKey();
  window.localStorage.setItem(KEY_STORAGE, pk);
  return pk;
}

function geolocationFailureMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: number }).code;
    const message = (error as { message?: string }).message;
    switch (code) {
      case 1:
        return (
          "Location permission was denied. Open your browser settings and allow location access for this site, then retry."
        );
      case 2:
        return `Location unavailable: ${message ?? "please check device GPS and network services."}`;
      case 3:
        return "Location request timed out. Try again with better GPS signal.";
      default:
        return message ?? "Unable to read device location.";
    }
  }
  if (error instanceof Error) return error.message;
  return "Unable to read device location.";
}

async function getLocationPermissionState(): Promise<PermissionState | null> {
  if (!("permissions" in navigator)) return null;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" } as PermissionDescriptor);
    return status.state;
  } catch {
    return null;
  }
}

type Phase = "idle" | "locating" | "resolving" | "signing" | "submitting" | "done" | "error";

export function Miner() {
  const accountRef = useRef<ReturnType<typeof privateKeyToAccount> | null>(null);
  const [address, setAddress] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");
  const [coords, setCoords] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [triangle, setTriangle] = useState<TriangleInfo | null>(null);
  const [record, setRecord] = useState<ClaimRecord | null>(null);
  const [balance, setBalance] = useState<string>("0");

  useEffect(() => {
    const account = privateKeyToAccount(loadOrCreateKey());
    accountRef.current = account;
    setAddress(account.address);
  }, []);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const r = await fetch(`/api/balance?wallet=${addr}`);
      if (r.ok) setBalance((await r.json()).trinity ?? "0");
    } catch {
      /* offline ok */
    }
  }, []);

  useEffect(() => {
    if (address) refreshBalance(address);
  }, [address, refreshBalance]);

  const getLocation = () =>
    new Promise<{ lat: number; lon: number; acc: number }>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("geolocation unavailable"));
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            acc: p.coords.accuracy,
          }),
        (e) => reject(new Error(geolocationFailureMessage(e))),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });

  const mine = useCallback(async () => {
    const account = accountRef.current;
    if (!account) return;
    setRecord(null);
    try {
      setPhase("locating");
      setMessage("Reading your location…");
      const permission = await getLocationPermissionState();
      if (permission === "denied") {
        throw new Error(
          "Location permission is blocked for this site. Enable it in browser settings and retry.",
        );
      }

      const loc = await getLocation();
      setCoords(loc);

      setPhase("resolving");
      setMessage("Resolving your spherical triangle…");
      const triRes = await fetch(`/api/resolve?lat=${loc.lat}&lon=${loc.lon}`);
      const triPayload = await triRes.json();
      if (!triRes.ok) {
        throw new Error(
          triPayload && typeof triPayload === "object" && "error" in triPayload
            ? String((triPayload as { error: unknown }).error)
            : "could not resolve triangle (is the stack running?)",
        );
      }
      const tri: TriangleInfo = triPayload;
      setTriangle(tri);

      setPhase("signing");
      setMessage("Signing your proof-of-presence…");
      const nonceRes = await fetch("/api/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: account.address }),
      });
      if (!nonceRes.ok) throw new Error("nonce request failed");
      const { nonce } = await nonceRes.json();

      const claim = await signClaim(
        buildUnsignedClaim({
          wallet: account.address,
          triangleId: tri.triangle_id,
          meshLevel: tri.level,
          latitude: loc.lat,
          longitude: loc.lon,
          horizontalAccuracyM: loc.acc,
          nonce,
        }),
        account,
      );

      setPhase("submitting");
      setMessage("Submitting to validators…");
      const subRes = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim }),
      });
      const rec: ClaimRecord = await subRes.json();
      setRecord(rec);
      setPhase("done");
      setMessage(
        rec.status === "finalised"
          ? "Trinity mined!"
          : `Claim ${rec.status}${rec.reject_reasons?.length ? ": " + rec.reject_reasons.join(", ") : ""}`,
      );
      if (rec.status === "finalised") await refreshBalance(account.address);
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "something went wrong");
    }
  }, [refreshBalance]);

  const busy = ["locating", "resolving", "signing", "submitting"].includes(phase);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          STEP<span className="text-emerald-400"> Miner</span>
        </h1>
        <p className="text-sm text-neutral-400">
          Prove you are physically inside a spherical triangle and mine Trinity.
        </p>
        <p className="rounded bg-amber-900/40 px-2 py-1 text-xs text-amber-300">
          Internal testnet · Trinity has no monetary value
        </p>
      </header>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="text-xs text-neutral-500">Your wallet (self-custody, this device)</div>
        <div className="mt-1 break-all font-mono text-xs text-neutral-300">{address || "…"}</div>
        <p className="mt-2 text-[11px] text-neutral-500">
          If you do not have a wallet yet, one is created automatically in this browser. Keep this
          browser+device for the same wallet on next use.
        </p>
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-xs text-neutral-500">Trinity balance</span>
          <span className="text-2xl font-semibold">{balance}</span>
        </div>
      </section>

      <button
        onClick={mine}
        disabled={busy || !address}
        className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Mining…" : "Mine my triangle"}
      </button>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            phase === "error"
              ? "bg-red-950/60 text-red-300"
              : phase === "done" && record?.status === "finalised"
                ? "bg-emerald-950/60 text-emerald-300"
                : "bg-neutral-900 text-neutral-300"
          }`}
        >
          {message}
        </div>
      )}

      {coords && (
        <dl className="space-y-1 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400">
          <div className="flex justify-between">
            <dt>Location</dt>
            <dd className="font-mono">
              {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)} (±{coords.acc.toFixed(0)} m)
            </dd>
          </div>
          {triangle && (
            <>
              <div className="flex justify-between">
                <dt>Triangle</dt>
                <dd className="font-mono">{triangle.triangle_id}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Side length</dt>
                <dd>{triangle.min_side_m.toFixed(1)} m</dd>
              </div>
            </>
          )}
          {record?.tx_hash && (
            <div className="flex justify-between">
              <dt>Tx</dt>
              <dd className="font-mono">{record.tx_hash.slice(0, 14)}…</dd>
            </div>
          )}
        </dl>
      )}

      <footer className="pt-2 text-center text-[11px] text-neutral-600">
        Raw location is used only to build this proof and is never published — only proof
        hashes go on-chain. Map data © OpenStreetMap contributors.
      </footer>
    </div>
  );
}
