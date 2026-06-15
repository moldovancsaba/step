import "./styles.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { buildUnsignedClaim, signClaim } from "@step/proof-protocol";
import type { GatewayClaimRecord, IndexerStats } from "@step/api-client";
import type { Hex } from "@step/shared-types";

declare global {
  interface Window {
    STEP_CONFIG?: Partial<AppConfig>;
  }
}

interface AppConfig {
  gatewayUrl: string;
  indexerUrl: string;
}

interface TriangleInfo {
  triangle_id: string;
  triangle_id_hash: Hex;
  level: number;
  min_side_m: number;
  area_m2: number;
  centroid: { lat: number; lon: number };
}

const KEY_STORAGE = "step.static.pk.v1";
const CONFIG_STORAGE = "step.static.config.v1";

const defaultConfig: AppConfig = {
  gatewayUrl: window.STEP_CONFIG?.gatewayUrl ?? "http://127.0.0.1:8080",
  indexerUrl: window.STEP_CONFIG?.indexerUrl ?? "http://127.0.0.1:8090",
};

function loadConfig(): AppConfig {
  const stored = window.localStorage.getItem(CONFIG_STORAGE);
  if (!stored) return defaultConfig;
  try {
    return { ...defaultConfig, ...JSON.parse(stored) };
  } catch {
    return defaultConfig;
  }
}

function saveConfig(config: AppConfig) {
  window.localStorage.setItem(CONFIG_STORAGE, JSON.stringify(config));
}

function loadOrCreateAccount(): Account {
  const existing = window.localStorage.getItem(KEY_STORAGE) as Hex | null;
  const key = existing ?? generatePrivateKey();
  if (!existing) window.localStorage.setItem(KEY_STORAGE, key);
  return privateKeyToAccount(key);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `HTTP ${resp.status} from ${url}`,
    );
  }
  return body as T;
}

function short(value: string, left = 10, right = 6) {
  return value.length > left + right ? `${value.slice(0, left)}...${value.slice(-right)}` : value;
}

function App() {
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [account, setAccount] = useState<Account | null>(null);
  const [tab, setTab] = useState<"mine" | "explore" | "settings">("mine");

  useEffect(() => {
    setAccount(loadOrCreateAccount());
  }, []);

  const updateConfig = (next: AppConfig) => {
    setConfig(next);
    saveConfig(next);
  };

  const resetWallet = () => {
    const key = generatePrivateKey();
    window.localStorage.setItem(KEY_STORAGE, key);
    setAccount(privateKeyToAccount(key));
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>STEP Sandbox</h1>
          <p>Browser mining and explorer for the local Mac-hosted testnet.</p>
        </div>
        <nav>
          <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
            Mine
          </button>
          <button className={tab === "explore" ? "active" : ""} onClick={() => setTab("explore")}>
            Explorer
          </button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
            Settings
          </button>
        </nav>
      </header>

      {tab === "mine" && account && <Miner account={account} config={config} />}
      {tab === "explore" && <Explorer config={config} />}
      {tab === "settings" && (
        <Settings
          account={account}
          config={config}
          onConfig={updateConfig}
          onResetWallet={resetWallet}
        />
      )}
    </main>
  );
}

function Miner({ account, config }: { account: Account; config: AppConfig }) {
  const [phase, setPhase] = useState("idle");
  const [message, setMessage] = useState("");
  const [triangle, setTriangle] = useState<TriangleInfo | null>(null);
  const [record, setRecord] = useState<GatewayClaimRecord | null>(null);
  const busy = useMemo(() => phase !== "idle" && phase !== "done" && phase !== "error", [phase]);

  async function getLocation() {
    return new Promise<{ lat: number; lon: number; acc: number }>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("geolocation is unavailable in this browser"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc: pos.coords.accuracy,
          }),
        (err) => reject(new Error(err.message)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    });
  }

  async function mine() {
    setRecord(null);
    setTriangle(null);
    try {
      setPhase("locating");
      setMessage("Reading device location...");
      const loc = await getLocation();

      setPhase("resolving");
      setMessage("Resolving MESH triangle...");
      const tri = await json<TriangleInfo>(
        `${config.gatewayUrl}/v1/mesh/resolve?lat=${loc.lat}&lon=${loc.lon}&level=21`,
      );
      setTriangle(tri);

      setPhase("signing");
      setMessage("Requesting nonce and signing claim locally...");
      const nonce = await json<{ nonce: string }>(`${config.gatewayUrl}/v1/nonce`, {
        method: "POST",
        body: JSON.stringify({ wallet: account.address }),
      });
      const claim = await signClaim(
        buildUnsignedClaim({
          wallet: account.address,
          triangleId: tri.triangle_id,
          meshLevel: 21,
          latitude: loc.lat,
          longitude: loc.lon,
          horizontalAccuracyM: loc.acc,
          nonce: nonce.nonce,
        }),
        account,
      );

      setPhase("submitting");
      setMessage("Submitting claim to gateway and validators...");
      const submitted = await json<GatewayClaimRecord>(`${config.gatewayUrl}/v1/claims`, {
        method: "POST",
        body: JSON.stringify({ claim }),
      });
      setRecord(submitted);
      setPhase(submitted.status === "rejected" ? "error" : "done");
      setMessage(
        submitted.status === "finalised"
          ? "Claim finalised. Trinity mined on the internal testnet."
          : `Claim ${submitted.status}: ${submitted.reject_reasons.join(", ") || "waiting"}`,
      );
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "claim failed");
    }
  }

  return (
    <section className="grid">
      <article className="panel">
        <div className="eyebrow">Wallet</div>
        <p className="mono break">{account.address}</p>
        <p className="muted">
          This sandbox key is stored in this browser only. Trinity here is an internal-testnet
          unit with no monetary value.
        </p>
      </article>

      <article className="panel callout">
        <button className="primary" disabled={busy} onClick={mine}>
          {busy ? "Mining..." : "Mine my current triangle"}
        </button>
        {message && <p className={phase === "error" ? "error" : "status"}>{message}</p>}
      </article>

      {triangle && (
        <article className="panel wide">
          <div className="eyebrow">Resolved triangle</div>
          <h2 className="mono">{triangle.triangle_id}</h2>
          <dl>
            <dt>Triangle hash</dt>
            <dd className="mono">{short(triangle.triangle_id_hash)}</dd>
            <dt>Side</dt>
            <dd>{triangle.min_side_m.toFixed(1)} m</dd>
            <dt>Area</dt>
            <dd>{triangle.area_m2.toFixed(1)} m²</dd>
          </dl>
        </article>
      )}

      {record && (
        <article className="panel wide">
          <div className="eyebrow">Claim</div>
          <h2>{record.status}</h2>
          <dl>
            <dt>Claim hash</dt>
            <dd className="mono break">{record.claim_hash}</dd>
            <dt>Votes</dt>
            <dd>{record.votes.filter((v) => v.approve).length} approvals</dd>
            <dt>Transaction</dt>
            <dd className="mono">{record.tx_hash ? short(record.tx_hash) : "-"}</dd>
            <dt>Reasons</dt>
            <dd>{record.reject_reasons.join(", ") || "-"}</dd>
          </dl>
        </article>
      )}
    </section>
  );
}

function Explorer({ config }: { config: AppConfig }) {
  const [stats, setStats] = useState<IndexerStats | null>(null);
  const [claims, setClaims] = useState<Array<Record<string, string>>>([]);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setError("");
      const [nextStats, nextClaims] = await Promise.all([
        json<IndexerStats>(`${config.indexerUrl}/v1/stats`),
        json<Array<Record<string, string>>>(`${config.indexerUrl}/v1/claims`),
      ]);
      setStats(nextStats);
      setClaims(nextClaims);
    } catch (err) {
      setError(err instanceof Error ? err.message : "indexer unavailable");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [config.indexerUrl]);

  return (
    <section className="stack">
      {error && <p className="error">{error}</p>}
      <div className="stats">
        <Stat label="Total Trinity supply" value={stats?.total_supply ?? "-"} />
        <Stat label="Claims finalised" value={String(stats?.claims_finalised ?? "-")} />
        <Stat label="Sponsored claims" value={String(stats?.sponsored_claims ?? "-")} />
        <Stat label="Triangles touched" value={String(stats?.triangles_touched ?? "-")} />
      </div>
      <article className="panel wide">
        <div className="row">
          <h2>Recent claims</h2>
          <button onClick={refresh}>Refresh</button>
        </div>
        {claims.length === 0 ? (
          <p className="muted">No indexed claims yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Miner</th>
                <th>Kind</th>
                <th>Trinity</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {claims.slice(0, 25).map((claim) => (
                <tr key={claim.claim_hash}>
                  <td className="mono">{short(claim.claim_hash ?? "")}</td>
                  <td className="mono">{short(claim.miner ?? "")}</td>
                  <td>{claim.kind}</td>
                  <td>{claim.trinity_amount}</td>
                  <td>{claim.block_number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}

function Settings({
  account,
  config,
  onConfig,
  onResetWallet,
}: {
  account: Account | null;
  config: AppConfig;
  onConfig: (config: AppConfig) => void;
  onResetWallet: () => void;
}) {
  const gatewayRef = useRef<HTMLInputElement>(null);
  const indexerRef = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    onConfig({
      gatewayUrl: gatewayRef.current?.value.replace(/\/$/, "") ?? config.gatewayUrl,
      indexerUrl: indexerRef.current?.value.replace(/\/$/, "") ?? config.indexerUrl,
    });
  }

  return (
    <section className="stack">
      <article className="panel wide">
        <h2>Backend URLs</h2>
        <form onSubmit={submit}>
          <label>
            Gateway URL
            <input ref={gatewayRef} defaultValue={config.gatewayUrl} />
          </label>
          <label>
            Indexer URL
            <input ref={indexerRef} defaultValue={config.indexerUrl} />
          </label>
          <button className="primary">Save settings</button>
        </form>
      </article>
      <article className="panel wide">
        <h2>Wallet</h2>
        <p className="mono break">{account?.address ?? "-"}</p>
        <button onClick={onResetWallet}>Generate new sandbox wallet</button>
      </article>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="panel stat">
      <div className="eyebrow">{label}</div>
      <strong>{value}</strong>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
