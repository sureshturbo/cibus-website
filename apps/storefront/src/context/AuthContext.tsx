import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api.js";
import { useCart } from "./CartContext.js";
import type { Customer } from "../types.js";

interface AuthApi {
  user: Customer | null;
  /** False until the initial session check settles, so guards wait instead of flashing the sign-in screen. */
  ready: boolean;
  login: (email: string, password: string) => Promise<Customer>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  }) => Promise<Customer>;
  logout: () => Promise<void>;
  /** Re-reads the session; used after the access cookie is refreshed in the background. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Customer | null>(null);
  const [ready, setReady] = useState(false);
  const { refresh: refreshCart } = useCart();

  const refresh = useCallback(async () => {
    try {
      setUser(await api.session());
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Signing in is required to place an order, so the guest basket has to be
   * folded into the account immediately. Without this merge the shopper sees an
   * empty cart after authenticating and has no idea why.
   */
  const adoptSession = useCallback(
    async (customer: Customer) => {
      setUser(customer);
      try {
        await api.mergeCart();
      } catch {
        // A merge failure must not block sign-in itself.
      }
      await refreshCart();
      return customer;
    },
    [refreshCart],
  );

  const value = useMemo<AuthApi>(
    () => ({
      user,
      ready,
      login: async (email, password) => adoptSession(await api.login(email, password)),
      register: async (input) => adoptSession(await api.register(input)),
      logout: async () => {
        await api.logout();
        setUser(null);
        await refreshCart();
      },
      refresh,
    }),
    [user, ready, adoptSession, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}