import "./styles.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Account } from "viem";
import { buildUnsignedClaim, signClaim } from "@step/proof-protocol";
import type { GatewayClaimRecord, IndexerStats } from "@step/api-client";
import type { Hex } from "@step/shared-types";
import MeshMap from "./MeshMap";

declare global {
  interface Window {
    STEP_CONFIG?: Partial<AppConfig>;
  }
}

interface AppConfig {
  gatewayUrl: string;
  indexerUrl: string;
  explorerUrl?: string;
  minerUrl?: string;
}

type AppTab = "mine" | "explore" | "settings";

interface TriangleInfo {
  triangle_id: string;
  triangle_id_hash: Hex;
  level: number;
  min_side_m: number;
  area_m2: number;
  centroid: { lat: number; lon: number };
}

interface WalletFilePayload {
  version: 1;
  kind: "step-wallet-profile";
  alias: string;
  address: string;
  privateKey: Hex;
  createdAt: string;
}

const DEFAULT_MESH_LEVEL = 21;
const DEFAULT_WALLET_ALIAS = "Local wallet";
const DEFAULT_WALLET_FILE_NAME = "step-wallet-profile";

const MESH_LEVEL_BY_ACCURACY = [
  { maxAccuracy: 25, level: 21 },
  { maxAccuracy: 50, level: 20 },
  { maxAccuracy: 100, level: 19 },
  { maxAccuracy: 200, level: 18 },
  { maxAccuracy: 400, level: 17 },
  { maxAccuracy: 800, level: 16 },
  { maxAccuracy: Infinity, level: 15 },
] as const;

const MESH_LEVEL_FALLBACK_ORDER = [21, 20, 19, 18, 17, 16, 15];

const MESH_ACCURACY_GUIDE = [
  "For level 21 targets, keep accuracy at 25m or better.",
  "For level 20 targets, keep accuracy around 50m (actual level-20 side is ~13.6m).",
  "For level 19 targets, keep accuracy around 100m.",
  "For level 18 targets, keep accuracy around 200m.",
  "For level 17 targets, keep accuracy around 400m.",
  "For level 16 targets, keep accuracy around 800m.",
  "If weaker than 800m, the app falls back to lower levels automatically.",
];

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

function resolveInitialTab(pathname: string): AppTab {
  const clean = normalizePath(pathname);
  if (clean.startsWith("/miner")) return "mine";
  if (clean.startsWith("/explorer")) return "explore";
  return "mine";
}

function shouldShowMesh(pathname: string) {
  return normalizePath(pathname).startsWith("/explorer/mesh");
}

const CONFIG_STORAGE = "step.static.config.v1";
const LEGACY_KEY_STORAGE = "step.static.pk.v1";
const KEY_STORAGE = "step.wallet.pk.v1";
const KEY_ALIAS_STORAGE = "step.wallet.alias.v1";

const defaultConfig: AppConfig = {
  gatewayUrl: window.STEP_CONFIG?.gatewayUrl ?? "http://127.0.0.1:8080",
  indexerUrl: window.STEP_CONFIG?.indexerUrl ?? "http://127.0.0.1:8090",
  explorerUrl: window.STEP_CONFIG?.explorerUrl ?? "",
  minerUrl: window.STEP_CONFIG?.minerUrl ?? "",
};

function safeReadStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignored
  }
}

function normalizePrivateKeyInput(value: string): Hex | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith("0x")) return null;
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as Hex) : null;
}

function normalizeWalletAlias(value: string) {
  const normalized = value.trim();
  return normalized.length === 0 ? DEFAULT_WALLET_ALIAS : normalized;
}

function loadConfig(): AppConfig {
  const stored = safeReadStorage(CONFIG_STORAGE);
  if (!stored) return defaultConfig;
  try {
    return { ...defaultConfig, ...JSON.parse(stored) };
  } catch {
    return defaultConfig;
  }
}

function saveConfig(config: AppConfig) {
  safeWriteStorage(CONFIG_STORAGE, JSON.stringify(config));
}

function loadStoredWallet(): { account: Account; key: Hex; persisted: boolean; alias: string } | null {
  const storedAlias = normalizeWalletAlias(safeReadStorage(KEY_ALIAS_STORAGE) || "");
  const legacyKey = safeReadStorage(LEGACY_KEY_STORAGE);
  const currentKey = safeReadStorage(KEY_STORAGE);
  const rawKey = currentKey || legacyKey;
  const parsed = rawKey ? normalizePrivateKeyInput(rawKey) : null;
  if (rawKey && parsed && currentKey !== parsed) {
    safeWriteStorage(KEY_STORAGE, parsed);
    if (legacyKey) safeRemoveStorage(LEGACY_KEY_STORAGE);
  }

  if (parsed) {
    return {
      account: privateKeyToAccount(parsed),
      key: parsed,
      persisted: !!currentKey,
      alias: storedAlias,
    };
  }

  return null;
}

function parseWalletImport(content: string): { key: Hex; alias: string; address?: string } | null {
  const raw = content.trim();
  if (!raw) return null;
  try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.kind === "step-wallet-profile" &&
        typeof parsed.privateKey === "string" &&
        typeof parsed.address === "string" &&
        typeof parsed.alias === "string"
      ) {
        const key = normalizePrivateKeyInput(parsed.privateKey);
        if (!key) return null;
        return { key, alias: normalizeWalletAlias(parsed.alias), address: parsed.address };
      }
    } catch {
      // ignore
    }
    const key = normalizePrivateKeyInput(raw);
    return key ? { key, alias: DEFAULT_WALLET_ALIAS } : null;
  }

function downloadWalletFile(alias: string, key: Hex, address: string) {
  const payload: WalletFilePayload = {
    version: 1,
    kind: "step-wallet-profile",
    alias: normalizeWalletAlias(alias),
    address,
    privateKey: key,
    createdAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const safeAlias = alias.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${DEFAULT_WALLET_FILE_NAME}-${safeAlias || "wallet"}-${Date.now()}.json`;
  link.click();
  window.URL.revokeObjectURL(url);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok) {
    const bodyText =
      body && typeof body === "object" && "message" in body
        ? String((body as Record<string, unknown>).message)
        : body && typeof body === "object" && "error" in body
          ? String((body as Record<string, unknown>).error)
          : `HTTP ${resp.status} from ${url}`;
    throw new Error(bodyText);
  }
  return body as T;
}

function chooseMeshLevelForAccuracy(accuracyM: number) {
  return MESH_LEVEL_BY_ACCURACY.find((entry) => accuracyM <= entry.maxAccuracy)?.level ?? DEFAULT_MESH_LEVEL;
}

function buildMeshAttemptLevels(startLevel: number) {
  const index = MESH_LEVEL_FALLBACK_ORDER.indexOf(startLevel);
  const base = index >= 0
    ? MESH_LEVEL_FALLBACK_ORDER.slice(index)
    : [DEFAULT_MESH_LEVEL, ...MESH_LEVEL_FALLBACK_ORDER.filter((level) => level < DEFAULT_MESH_LEVEL)];

  return [...new Set([DEFAULT_MESH_LEVEL, ...base])];
}

function isAccuracyTooLowReason(rejectReasons: string[]) {
  return rejectReasons.includes("accuracy_too_low");
}

function isLevelNotMineableReason(rejectReasons: string[]) {
  return (
    rejectReasons.includes("level_not_mineable") ||
    rejectReasons.some((reason) => reason.includes("LevelNotMineable"))
  );
}

function isRetryableReason(rejectReasons: string[]) {
  return isAccuracyTooLowReason(rejectReasons) || isLevelNotMineableReason(rejectReasons);
}

function short(value: string, left = 10, right = 6) {
  return value.length > left + right ? `${value.slice(0, left)}...${value.slice(-right)}` : value;
}

function maskToken(value: string, left = 12, right = 6) {
  return value.length > left + right ? `${value.slice(0, left)}...${value.slice(-right)}` : value;
}

function geolocationFailureMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: number }).code;
    const message = (error as { message?: string }).message;
    switch (code) {
      case 1:
        return "Location permission was denied. Open your browser settings and allow location access for this site, then retry.";
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

function App() {
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [account, setAccount] = useState<Account | null>(null);
  const [walletKey, setWalletKey] = useState<Hex | null>(null);
  const [walletAlias, setWalletAlias] = useState(DEFAULT_WALLET_ALIAS);
  const [walletAliasInput, setWalletAliasInput] = useState(DEFAULT_WALLET_ALIAS);
  const [walletTokenInput, setWalletTokenInput] = useState("");
  const [walletPersisted, setWalletPersisted] = useState(false);
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));
  const [tab, setTab] = useState<AppTab>(() => resolveInitialTab(path));
  const [accountNotice, setAccountNotice] = useState<string>("");
  const [configNotice, setConfigNotice] = useState<string>("");
  const showMesh = shouldShowMesh(path);

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setTab(resolveInitialTab(path));
  }, [path]);

  useEffect(() => {
    const storedAlias = normalizeWalletAlias(safeReadStorage(KEY_ALIAS_STORAGE) || DEFAULT_WALLET_ALIAS);
    setWalletAlias(storedAlias);
    setWalletAliasInput(storedAlias);
    setWalletPersisted(false);
    setAccountNotice("No active wallet. Create or import a wallet before mining.");
    setWalletTokenInput("");
  }, []);

  function navigateTo(newPath: string, nextTab: AppTab) {
    if (typeof window === "undefined") {
      setTab(nextTab);
      setPath(normalizePath(newPath));
      return;
    }
    const target = normalizePath(newPath);
    if (window.location.pathname !== target) {
      window.history.pushState({}, "", target);
    }
    setPath(target);
    setTab(nextTab);
  }

  const updateConfig = (next: AppConfig) => {
    setConfig(next);
    saveConfig(next);
    const saved = safeWriteStorage(CONFIG_STORAGE, JSON.stringify(next));
    setConfigNotice(saved ? "" : "Settings are not persisted because storage is unavailable.");
  };

  function applyWallet(next: { account: Account; key: Hex; persisted: boolean; alias: string }) {
    setAccount(next.account);
    setWalletKey(next.key);
    setWalletAlias(next.alias);
    setWalletAliasInput(next.alias);
    setWalletPersisted(next.persisted);
    setWalletTokenInput("");
  }

  function updateWalletAlias(value: string) {
    const nextAlias = normalizeWalletAlias(value);
    setWalletAlias(nextAlias);
    setWalletAliasInput(nextAlias);
    const saved = safeWriteStorage(KEY_ALIAS_STORAGE, nextAlias);
    if (account) {
      setAccountNotice(saved ? "Wallet name saved." : "Wallet name updated for this session only.");
    }
  }

  const loadWalletFromStorage = () => {
    const loaded = loadStoredWallet();
    if (!loaded) {
      setAccountNotice("No saved wallet was found in this browser.");
      return;
    }
    applyWallet(loaded);
    setAccountNotice("Saved wallet loaded into session.");
  };

  const loadWalletFromText = (content: string) => {
    const parsed = parseWalletImport(content);
    if (!parsed) {
      setAccountNotice("Wallet file is not valid. Upload a STEP wallet file or a raw 0x private key.");
      return;
    }
    const resolvedAccount = privateKeyToAccount(parsed.key);
    if (
      parsed.address &&
      parsed.address.toLowerCase() !== resolvedAccount.address.toLowerCase()
    ) {
      setAccountNotice("Wallet file content is invalid: private key and address mismatch.");
      return;
    }
    applyWallet({
      account: resolvedAccount,
      key: parsed.key,
      persisted: false,
      alias: parsed.alias || walletAlias,
    });
    setAccountNotice("Wallet loaded from file.");
  };

  const saveWalletToFile = () => {
    if (!account || !walletKey) {
      setAccountNotice("No wallet loaded to export.");
      return;
    }
    downloadWalletFile(walletAlias, walletKey, account.address);
    setAccountNotice("Wallet file downloaded. Keep this file safe and private.");
  };

  const generateWallet = (persist: boolean) => {
    const key = generatePrivateKey();
    const nextAlias = walletAlias || DEFAULT_WALLET_ALIAS;
    applyWallet({ account: privateKeyToAccount(key), key, persisted: persist, alias: nextAlias });

    if (persist) {
      const saved = safeWriteStorage(KEY_STORAGE, key);
      setWalletPersisted(saved);
      setAccountNotice(
        saved
          ? "Generated and persisted a new local wallet."
          : "Generated a new local wallet. It is active for this session only.",
      );
      return;
    }

    safeRemoveStorage(KEY_STORAGE);
    setWalletPersisted(false);
    setAccountNotice("Generated a new temporary wallet for this session.");
  };

  const saveCurrentWallet = () => {
    if (!walletKey) {
      setAccountNotice("No wallet loaded to save.");
      return;
    }
    const saved = safeWriteStorage(KEY_STORAGE, walletKey);
    setWalletPersisted(saved);
    setAccountNotice(
      saved
        ? "Current wallet token saved in this browser."
        : "Could not save token because storage is unavailable.",
    );
  };

  const clearSavedWallet = () => {
    safeRemoveStorage(KEY_STORAGE);
    setWalletPersisted(false);
    setAccountNotice("Saved wallet token removed. Wallet now runs as session-only. Copy token to migrate to another device.");
  };

  const loginWallet = (token: string) => {
    const parsed = normalizePrivateKeyInput(token);
    if (!parsed) {
      setAccountNotice("Wallet token is invalid. Paste the 0x private key you created earlier.");
      return;
    }

    const alias = walletAlias || DEFAULT_WALLET_ALIAS;
    applyWallet({
      account: privateKeyToAccount(parsed),
      key: parsed,
      persisted: false,
      alias,
    });
    setAccountNotice(`Wallet ${short(parsed)} loaded into session. Save it if you want browser persistence.`);
  };

  const createTemporaryWallet = () => {
    generateWallet(false);
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>STEP</h1>
          <p>Browser mining and explorer for the STEP pilot stack.</p>
        </div>
        <nav>
          <button
            className={tab === "mine" ? "active" : ""}
            onClick={() => navigateTo("/miner", "mine")}
          >
            Mine
          </button>
          <button
            className={tab === "explore" ? "active" : ""}
            onClick={() => navigateTo("/explorer", "explore")}
          >
            Explorer
          </button>
          {config.minerUrl && (
            <a className="external" href={config.minerUrl} target="_blank" rel="noreferrer">
              Dedicated miner
            </a>
          )}
          {config.explorerUrl && (
            <a className="external" href={config.explorerUrl} target="_blank" rel="noreferrer">
              Dedicated explorer
            </a>
          )}
          <button
            className={tab === "settings" ? "active" : ""}
            onClick={() => navigateTo("/", "settings")}
          >
            Settings
          </button>
        </nav>
      </header>

      {tab === "mine" && account && walletKey ? (
        <Miner
          account={account}
          config={config}
          walletAlias={walletAlias}
          walletKey={walletKey}
          walletPersisted={walletPersisted}
          accountNotice={accountNotice}
        />
      ) : (
        tab === "mine" && (
          <section className="stack">
            <article className="panel wide">
              <div className="eyebrow">Wallet required</div>
              <p className="muted">
                Mine mode is disabled until you create a wallet or import one from a downloaded file.
              </p>
              <p className="muted">
                Use Settings to create a wallet, import from file, or paste a private key.
              </p>
              <button onClick={() => navigateTo("/", "settings")}>Open wallet settings</button>
              {accountNotice && <p className="error">{accountNotice}</p>}
            </article>
          </section>
        )
      )}
      {tab === "explore" && (
        <Explorer
          config={config}
          meshMode={showMesh}
          onNavigate={(nextPath) => navigateTo(nextPath, "explore")}
        />
      )}
      {tab === "settings" && (
        <Settings
          account={account}
          walletKey={walletKey}
          walletAlias={walletAlias}
          walletAliasInput={walletAliasInput}
          walletTokenInput={walletTokenInput}
          walletPersisted={walletPersisted}
          config={config}
          onConfig={updateConfig}
          onCreateTemporaryWallet={createTemporaryWallet}
          onLoadWalletFromStorage={loadWalletFromStorage}
          onSaveWalletToFile={saveWalletToFile}
          onLoginWallet={loginWallet}
          onSaveWallet={saveCurrentWallet}
          onClearSavedWallet={clearSavedWallet}
          onSetWalletAlias={updateWalletAlias}
          onWalletAliasChange={setWalletAliasInput}
          onWalletTokenChange={setWalletTokenInput}
          onLoadWalletFromText={loadWalletFromText}
          accountNotice={accountNotice}
          configNotice={configNotice}
        />
      )}
    </main>
  );
}

function Miner({
  account,
  config,
  walletAlias,
  walletKey,
  walletPersisted,
  accountNotice,
}: {
  account: Account;
  config: AppConfig;
  walletAlias: string;
  walletKey: Hex | null;
  walletPersisted: boolean;
  accountNotice: string;
}) {
  const [phase, setPhase] = useState("idle");
  const [message, setMessage] = useState("");
  const [meshAdvice, setMeshAdvice] = useState("");
  const [triangle, setTriangle] = useState<TriangleInfo | null>(null);
  const [record, setRecord] = useState<GatewayClaimRecord | null>(null);
  const busy = useMemo(() => phase !== "idle" && phase !== "done" && phase !== "error", [phase]);
  const [copiedToken, setCopiedToken] = useState(false);

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
        (err) => reject(geolocationFailureMessage(err)),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    });
  }

  async function mine() {
    setRecord(null);
    setTriangle(null);
    setMeshAdvice("");
    try {
      setPhase("locating");
      setMessage("Reading device location...");
      const permission = await getLocationPermissionState();
      if (permission === "denied") {
        throw new Error(
          "Location permission is blocked for this site. Enable it in browser settings and retry.",
        );
      }

      const loc = await getLocation();
      const startLevel = chooseMeshLevelForAccuracy(loc.acc);
      const levelSequence = buildMeshAttemptLevels(startLevel);

      for (let i = 0; i < levelSequence.length; i++) {
        const attemptLevel = levelSequence[i] as number;
        const resolutionHint =
          attemptLevel < DEFAULT_MESH_LEVEL
            ? `Trying level ${attemptLevel} because location accuracy is ${loc.acc.toFixed(1)}m.`
            : `Trying level ${attemptLevel}.`;
        setMessage(resolutionHint);
        setPhase("resolving");
        const tri = await json<TriangleInfo>(
          `${config.gatewayUrl}/v1/mesh/resolve?lat=${loc.lat}&lon=${loc.lon}&level=${attemptLevel}`,
        );
        setMeshAdvice(
          `${resolutionHint} Level ${attemptLevel} triangle side is ${tri.min_side_m.toFixed(1)}m at this location.`
        );
        setTriangle(tri);

        setMessage("Requesting nonce and signing claim locally...");
        setPhase("signing");
        const nonce = await json<{ nonce: string }>(`${config.gatewayUrl}/v1/nonce`, {
          method: "POST",
          body: JSON.stringify({ wallet: account.address }),
        });
        const claim = await signClaim(
          buildUnsignedClaim({
            wallet: account.address,
            triangleId: tri.triangle_id,
            meshLevel: attemptLevel,
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

        const reasons = submitted.reject_reasons ?? [];
        const isRetryableRejection =
          submitted.status === "rejected" &&
          reasons.length > 0 &&
          isRetryableReason(reasons);

        if (submitted.status !== "rejected" || !isRetryableRejection) {
          setPhase(submitted.status === "rejected" ? "error" : "done");
          setMessage(
            submitted.status === "finalised"
              ? "Claim finalised. Trinity mined on the internal testnet."
              : `Claim ${submitted.status}: ${submitted.reject_reasons.join(", ") || "waiting"}`,
          );
          return;
        }

        if (i < levelSequence.length - 1) {
          const nextLevel = levelSequence[i + 1];
          const reasonHint = isLevelNotMineableReason(reasons)
            ? "level not mineable"
            : "accuracy too low";
          setMessage(`${reasonHint} at level ${attemptLevel}. Retrying at level ${nextLevel}...`);
          continue;
        }

        setPhase("error");
        const finalHint = isAccuracyTooLowReason(reasons)
          ? `accuracy still too low at level ${attemptLevel}`
          : isLevelNotMineableReason(reasons)
            ? `level ${attemptLevel} is not mineable in this network`
            : `mining cannot continue at level ${attemptLevel}`;
        setMessage(
          `Rejected: ${finalHint}.`,
        );
        return;
      }
    } catch (err) {
      setPhase("error");
      const messageText = err instanceof Error ? err.message : geolocationFailureMessage(err);
      setMessage(messageText);
    }
  }

  return (
    <section className="grid">
      <article className="panel">
        <div className="eyebrow">Wallet</div>
        <p className="mono break">{walletAlias}</p>
        <p className="mono break">{account.address}</p>
        <div className="wallet-token-line">
          <p className="mono">Token: {walletKey ? maskToken(walletKey) : "-"}</p>
          {walletKey && (
            <button
              className="tiny"
              onClick={() => {
                void navigator.clipboard?.writeText(walletKey);
                setCopiedToken(true);
                setTimeout(() => setCopiedToken(false), 1300);
              }}
            >
              {copiedToken ? "Copied" : "Copy token"}
            </button>
          )}
        </div>
        <p className="muted">
          Storage mode: {walletPersisted ? "saved token" : "session-only"}.
        </p>
        <p className="muted">You are logged in as this wallet when signing and submitting claims.</p>
        <p className="muted">
          Trinity here is an internal-testnet unit with no monetary value.
        </p>
        {accountNotice && <p className="muted">{accountNotice}</p>}
      </article>

      <article className="panel">
        <div className="eyebrow">Accuracy guidance</div>
        <ul className="mono">
          {MESH_ACCURACY_GUIDE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {meshAdvice && <p className="muted">{meshAdvice}</p>}
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

function Explorer({
  config,
  meshMode,
  onNavigate,
}: {
  config: AppConfig;
  meshMode: boolean;
  onNavigate: (nextPath: string) => void;
}) {
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
        <div className="row">
          <button className="primary" onClick={() => onNavigate(meshMode ? "/explorer" : "/explorer/mesh")}>
            {meshMode ? "Back to explorer table" : "Open MESH map"}
          </button>
          <span className="mesh-mode-pill">{meshMode ? "Mesh map mode" : "Explorer table mode"}</span>
        </div>
        {meshMode && <MeshMap gatewayUrl={config.gatewayUrl} indexerUrl={config.indexerUrl} />}
        {claims.length === 0 ? <p className="muted">No indexed claims yet.</p> : (
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
  walletKey,
  walletAlias,
  walletAliasInput,
  walletTokenInput,
  walletPersisted,
  onConfig,
  onCreateTemporaryWallet,
  onLoadWalletFromStorage,
  onSaveWalletToFile,
  onLoginWallet,
  onSaveWallet,
  onClearSavedWallet,
  onSetWalletAlias,
  onWalletAliasChange,
  onWalletTokenChange,
  onLoadWalletFromText,
  accountNotice,
  configNotice,
}: {
  account: Account | null;
  config: AppConfig;
  walletKey: Hex | null;
  walletAlias: string;
  walletAliasInput: string;
  walletTokenInput: string;
  walletPersisted: boolean;
  onConfig: (config: AppConfig) => void;
  onCreateTemporaryWallet: () => void;
  onLoadWalletFromStorage: () => void;
  onSaveWalletToFile: () => void;
  onLoginWallet: (token: string) => void;
  onSaveWallet: () => void;
  onClearSavedWallet: () => void;
  onSetWalletAlias: (alias: string) => void;
  onWalletAliasChange: (alias: string) => void;
  onWalletTokenChange: (token: string) => void;
  onLoadWalletFromText: (content: string) => void;
  accountNotice: string;
  configNotice: string;
}) {
  const gatewayRef = useRef<HTMLInputElement>(null);
  const indexerRef = useRef<HTMLInputElement>(null);
  const explorerRef = useRef<HTMLInputElement>(null);
  const minerRef = useRef<HTMLInputElement>(null);
  const walletFileRef = useRef<HTMLInputElement>(null);
  const [walletMessage, setWalletMessage] = useState("");

  function submitConfig(event: React.FormEvent) {
    event.preventDefault();
    onConfig({
      gatewayUrl: gatewayRef.current?.value.replace(/\/$/, "") ?? config.gatewayUrl,
      indexerUrl: indexerRef.current?.value.replace(/\/$/, "") ?? config.indexerUrl,
      explorerUrl: explorerRef.current?.value.replace(/\/$/, "") || undefined,
      minerUrl: minerRef.current?.value.replace(/\/$/, "") || undefined,
    });
  }

  function submitTokenLogin(event: React.FormEvent) {
    event.preventDefault();
    onLoginWallet(walletTokenInput);
    setWalletMessage("Wallet login attempted.");
  }

  function submitWalletFileLoad(event: React.FormEvent) {
    event.preventDefault();
    const file = walletFileRef.current?.files?.[0];
    if (!file) {
      setWalletMessage("Choose a wallet file first.");
      return;
    }
    void file
      .text()
      .then((content) => {
        onLoadWalletFromText(content);
        setWalletMessage("Wallet file loaded.");
      })
      .catch(() => setWalletMessage("Could not read the wallet file."));
  }

  return (
    <section className="stack">
      <article className="panel wide">
        <h2>Backend URLs</h2>
        <form onSubmit={submitConfig}>
          <label>
            Gateway URL
            <input ref={gatewayRef} defaultValue={config.gatewayUrl} />
          </label>
          <label>
            Indexer URL
            <input ref={indexerRef} defaultValue={config.indexerUrl} />
          </label>
          <label>
            Explorer URL (optional, e.g. https://step-explorer.example.com/mesh)
            <input
              ref={explorerRef}
              defaultValue={config.explorerUrl}
              placeholder="https://step-explorer.example.com/mesh"
            />
          </label>
          <label>
            Miner URL (optional, e.g. https://step-miner.example.com)
            <input
              ref={minerRef}
              defaultValue={config.minerUrl}
              placeholder="https://step-miner.example.com"
            />
          </label>
          <button className="primary">Save settings</button>
        </form>
        {configNotice && <p className="error">{configNotice}</p>}
      </article>

      <article className="panel wide">
        <h2>Wallet identity</h2>
        <p className="mono break">{account?.address ?? "-"}</p>
        <p className="eyebrow">{walletAlias}</p>
        <p className="muted">Storage mode: {walletPersisted ? "saved" : "session-only"}</p>
        <div className="wallet-controls">
          <button onClick={onCreateTemporaryWallet}>Create new wallet (session)</button>
          <button onClick={onLoadWalletFromStorage}>Load saved wallet</button>
        </div>
        <div className="wallet-controls">
          <label>
            Wallet name
            <input
              value={walletAliasInput}
              onChange={(event) => onWalletAliasChange(event.target.value)}
              placeholder="Wallet name"
            />
          </label>
          <button
            onClick={() => {
              onSetWalletAlias(walletAliasInput);
              setWalletMessage(`Wallet name set to ${normalizeWalletAlias(walletAliasInput)}.`);
            }}
          >
            Save name
          </button>
        </div>
        <div className="wallet-controls">
          <button
            onClick={() => {
              if (!walletKey) {
                setWalletMessage("No wallet available.");
                return;
              }
              void navigator.clipboard?.writeText(walletKey);
              setWalletMessage("Wallet token copied to clipboard.");
            }}
          >
            Copy current token
          </button>
          <button onClick={onSaveWalletToFile}>Export wallet file</button>
          <button className={walletPersisted ? "" : "primary"} onClick={onSaveWallet}>
            Save current token
          </button>
        </div>
        <div className="wallet-controls">
          <label className="wallet-file-upload">
            <span>Upload wallet file</span>
            <input ref={walletFileRef} type="file" accept=".json,.txt" />
          </label>
          <button onClick={onClearSavedWallet}>Forget saved token</button>
        </div>
        <form onSubmit={submitWalletFileLoad}>
          <button className="primary" type="submit">
            Load uploaded wallet file
          </button>
        </form>
        <p className="muted">Login with a wallet token to restore exact identity on any device.</p>
        <form onSubmit={submitTokenLogin}>
          <label>
            Wallet token
            <input
              type="password"
              value={walletTokenInput}
              onChange={(event) => onWalletTokenChange(event.target.value)}
              placeholder="0xabc..."
            />
          </label>
          <button className="primary">Load wallet from token</button>
        </form>
        {(walletMessage || accountNotice) && <p className="muted">{walletMessage || accountNotice}</p>}
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
