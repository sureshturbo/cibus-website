import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api.js";
import type { Cart } from "../types.js";

interface CartApi {
  cart: Cart | null;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (productId: number, quantity?: number) => Promise<void>;
  setQuantity: (productId: number, quantity: number) => Promise<void>;
  remove: (productId: number) => Promise<void>;
  clear: () => Promise<void>;
  merge: () => Promise<void>;
}

const CartContext = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside CartProvider");
  return context;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCart(await api.cart());
      setError(null);
    } catch {
      // A cart that cannot be read is not worth blocking the whole page for;
      // the header simply shows no count.
      setCart(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Every mutation returns the authoritative cart, so the response replaces
   * local state outright. Recomputing totals client-side is what lets a cart
   * badge disagree with the amount actually charged.
   */
  const run = useCallback(
    async (action: () => Promise<Cart>) => {
      setBusy(true);
      try {
        setCart(await action());
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Something went wrong");
        await refresh();
        throw caught;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const value = useMemo<CartApi>(
    () => ({
      cart,
      busy,
      error,
      refresh,
      add: (productId, quantity = 1) => run(() => api.addToCart(productId, quantity)),
      setQuantity: (productId, quantity) => run(() => api.setQuantity(productId, quantity)),
      remove: (productId) => run(() => api.removeItem(productId)),
      clear: () => run(() => api.clearCart()),
      merge: () => run(() => api.mergeCart()),
    }),
    [cart, busy, error, refresh, run],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}