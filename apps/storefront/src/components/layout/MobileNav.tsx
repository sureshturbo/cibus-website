import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Icon from "../Icon.js";
import type { IconName } from "../Icon.js";
import { useUi } from "../../context/UiContext.js";
import { useAuth } from "../../context/AuthContext.js";

const TABS: { to: string; icon: IconName; label: string }[] = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/products", icon: "grid4", label: "Shop" },
  { to: "/cart", icon: "cart", label: "Cart" },
  { to: "/account/orders", icon: "box", label: "Orders" },
  { to: "/account", icon: "user", label: "Account" },
];

/**
 * Fixed bottom navigation, the reference's most recognisable mobile trait. It
 * hides while an overlay is open, because two fixed bars would fight over the
 * same strip of screen.
 */
export default function MobileNav() {
  const location = useLocation();
  const { sheet } = useUi();
  const { user } = useAuth();

  const tabs = user ? TABS : TABS.filter((tab) => tab.to !== "/account");

  return (
    <nav
      className={sheet ? "mobile-nav mobile-nav--hidden" : "mobile-nav"}
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const active =
          tab.to === "/" ? location.pathname === "/" : location.pathname.startsWith(tab.to);

        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="mobile-nav__item"
            aria-current={active ? "page" : undefined}
          >
            <Icon name={tab.icon} size={21} />
            <span className="mobile-nav__label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      className={visible ? "to-top to-top--visible" : "to-top"}
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <Icon name="arrowUp" size={20} />
    </button>
  );
}