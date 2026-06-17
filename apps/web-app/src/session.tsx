/**
 * SessionContext (#3/#13): holds the signed-in identity, public address, and the
 * decrypted wallet private key IN MEMORY ONLY. The key is never persisted; it is
 * cleared on logout. Components sign with `signer()` during the session.
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
  session: SessionState | null;
  /** Present only while a wallet has been decrypted this session. */
  hasWallet: boolean;
  setSignedIn: (identity: string, address: Hex, walletKey: Hex) => void;
  /** A viem account for signing; throws if the wallet is not in memory. */
  signer: () => ReturnType<typeof privateKeyToAccount>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  // Kept in a ref-like state but never serialised; cleared on logout.
  const [walletKey, setWalletKey] = useState<Hex | null>(null);

  const setSignedIn = useCallback((identity: string, address: Hex, key: Hex) => {
    setSession({ identity, address });
    setWalletKey(key);
  }, []);

  const signer = useCallback(() => {
    if (!walletKey) throw new Error("wallet locked — sign in to unlock");
    return privateKeyToAccount(walletKey);
  }, [walletKey]);

  const logout = useCallback(async () => {
    setWalletKey(null);
    setSession(null);
    await account.logout().catch(() => undefined);
  }, []);

  return (
    <Ctx.Provider value={{ session, hasWallet: walletKey !== null, setSignedIn, signer, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): SessionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within SessionProvider");
  return v;
}
