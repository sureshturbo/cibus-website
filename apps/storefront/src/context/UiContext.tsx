import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api.js";
import type { Category, SiteConfig } from "../types.js";

/** The only overlays the site chrome can open, so they cannot stack on each other. */
export type SheetKind = "cart" | "search" | "menu" | "filters" | "auth";

interface UiApi {
  config: SiteConfig | null;
  categories: Category[];
  sheet: SheetKind | null;
  open: (kind: SheetKind) => void;
  close: () => void;
  toggle: (kind: SheetKind) => void;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const context = useContext(UiContext);
  if (!context) throw new Error("useUi must be used inside UiProvider");
  return context;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  useEffect(() => {
    // Both are needed by nearly every page, so they load once for the session.
    void api.config().then(setConfig).catch(() => undefined);
    void api
      .categories()
      .then((result) => setCategories(result.categories))
      .catch(() => undefined);
  }, []);

  const close = useCallback(() => setSheet(null), []);
  const open = useCallback((kind: SheetKind) => setSheet(kind), []);
  const toggle = useCallback((kind: SheetKind) => setSheet((s) => (s === kind ? null : kind)), []);

  const value = useMemo<UiApi>(
    () => ({ config, categories, sheet, open, close, toggle }),
    [config, categories, sheet, open, close, toggle],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}