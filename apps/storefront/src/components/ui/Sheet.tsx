import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon.js";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Icon shown beside the title, mirroring the reference's filter header. */
  icon?: ReactNode;
  side?: "right" | "left";
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Off-canvas panel. The reference uses this shape for the cart, the filter
 * drawer and the mobile menu, so it is built once and reused for all three.
 *
 * Escape closes, the backdrop closes, and body scroll is locked while open so
 * the page behind cannot move under the panel.
 */
export default function Sheet({
  open,
  onClose,
  title,
  icon,
  side = "right",
  footer,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    // Move focus into the panel so the next Tab stays inside it.
    panelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className={side === "left" ? "sheet sheet--left" : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="sheet__head">
          <h2 className="sheet__title">
            {icon}
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={`Close ${title}`}>
            <Icon name="close" size={20} />
          </button>
        </header>

        <div className="sheet__body">{children}</div>

        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </>,
    document.body,
  );
}