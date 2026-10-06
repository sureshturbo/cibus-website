import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

interface Toast {
  id: number;
  message: ReactNode;
  tone: "default" | "error";
}

interface ToastApi {
  /** `message` may contain a link, so the mini added-to-cart notice can offer one. */
  push: (message: ReactNode, tone?: Toast["tone"]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<ToastApi["push"]>(
    (message, tone = "default") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 3600);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Announced politely so a screen reader confirms an add-to-cart. */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={toast.tone === "error" ? "toast toast--error" : "toast"}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}