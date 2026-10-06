import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header.js";
import Footer from "./Footer.js";
import MobileNav, { BackToTop } from "./MobileNav.js";
import MiniCart, { SearchSheet } from "./CartSheets.js";
import AuthSheet, { MenuSheet } from "./AuthSheet.js";
import { useUi } from "../../context/UiContext.js";

/**
 * Site shell: header, routed page, footer, and the overlays the header can open.
 *
 * The overlays live here rather than in individual pages so a shopper can reach
 * the cart or sign-in from anywhere without every page wiring it up.
 */
export default function Layout() {
  const { sheet, close, categories } = useUi();
  const location = useLocation();

  // Moving between pages should start at the top; React Router only restores
  // scroll on back/forward navigations.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Header />

      <main id="main" className="site-main">
        <Outlet />
      </main>

      <Footer />

      <MobileNav />
      <BackToTop />

      <MiniCart open={sheet === "cart"} onClose={close} />
      <SearchSheet open={sheet === "search"} onClose={close} />
      <AuthSheet open={sheet === "auth"} onClose={close} />
      <MenuSheet open={sheet === "menu"} onClose={close} categories={categories} />
    </>
  );
}