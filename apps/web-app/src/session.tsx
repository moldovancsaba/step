/**
 * Two-layer session (#3/#13):
 *
 *  1. IDENTITY — `session` (identity + public address) established by a simple
 *     email + password login. This is *identification only*: it does NOT grant
 *     access to the wallet or mining.
 *  2. WALLET — the decrypted private key, held IN MEMORY ONLY, unlocked as a
 *     separate, deliberate step by providing the user's KEY (their downloaded
 *     key-backup file + password). The key is the authentication layer to the
 *     wallet and all value operations (mining, marketplace, signing). It is
 *     never persisted and is cleared on lock/logout.
 *
 * So: logging in identifies you; unlocking with your key authorizes the wallet.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { account } from "./api.js";

export interface SessionState {
  identity: string;
  address: Hex;
}

interface SessionContextValue {
  /** Identity layer — who you are (no wallet access on its own). */
  session: SessionState | null;
  /** Wallet layer — true only while the key is unlocked in memory. */
  walletUnlocked: boolean;
  /** Establish identity after a successful login. Wallet stays LOCKED. */
  signIn: (identity: string, address: Hex) => void;
  /** Authorize the wallet by loading the decrypted key into memory. */
  unlockWallet: (walletKey: Hex) => void;
  /** Drop the key from memory but stay identified. */
  lockWallet: () => void;
  /** A viem account for signing; throws if the wallet is locked. */
  signer: () => ReturnType<typeof privateKeyToAccount>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  // Never serialised; cleared on lock/logout.
  const [walletKey, setWalletKey] = useState<Hex | null>(null);

  const signIn = useCallback((identity: string, address: Hex) => {
    setSession({ identity, address });
    setWalletKey(null); // identity only — wallet must be unlocked separately
  }, []);

  const unlockWallet = useCallback((key: Hex) => setWalletKey(key), []);
  const lockWallet = useCallback(() => setWalletKey(null), []);

  const signer = useCallback(() => {
    if (!walletKey) throw new Error("Wallet locked — unlock it with your key to sign.");
    return privateKeyToAccount(walletKey);
  }, [walletKey]);

  const logout = useCallback(async () => {
    setWalletKey(null);
    setSession(null);
    await account.logout().catch(() => undefined);
  }, []);

  return (
    <Ctx.Provider
      value={{
        session,
        walletUnlocked: walletKey !== null,
        signIn,
        unlockWallet,
        lockWallet,
        signer,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within SessionProvider");
  return v;
}
