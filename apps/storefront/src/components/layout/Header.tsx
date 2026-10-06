import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon.js";
import { useCart } from "../../context/CartContext.js";
import { useUi } from "../../context/UiContext.js";
import { useAuth } from "../../context/AuthContext.js";

function AccountControl() {
  const { user } = useAuth();
  const { toggle } = useUi();

  if (user) {
    return (
      <Link to="/account" className="icon-btn" aria-label="Your account">
        <Icon name="user" size={22} />
      </Link>
    );
  }

  return (
    <button type="button" className="icon-btn" aria-label="Sign in" onClick={() => toggle("auth")}>
      <Icon name="user" size={22} />
    </button>
  );
}

function CartControl() {
  const { cart } = useCart();
  const { toggle } = useUi();
  const count = cart?.totalQuantity ?? 0;

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
      onClick={() => toggle("cart")}
    >
      <Icon name="cart" size={22} />
      {count > 0 ? <span className="counter">{count}</span> : null}
    </button>
  );
}

function HeaderActions() {
  const { toggle } = useUi();

  return (
    <div className="header-main__actions">
      <button
        type="button"
        className="icon-btn"
        aria-label="Search"
        onClick={() => toggle("search")}
      >
        <Icon name="search" size={22} />
      </button>
      <AccountControl />
      <CartControl />
    </div>
  );
}

/** Header tiers, collapsing the top two rows once the page is scrolled. */
function DesktopHeader() {
  const { config, categories } = useUi();
  const company = config?.company;

  return (
    <>
      <div className="campaign-bar">
        {config?.paymentEnabled
          ? "Secure online payment available"
          : "Payment is arranged when we confirm your order"}
      </div>

      <div className="header-main">
        <div className="container header-main__inner">
          <Link to="/" className="brand" aria-label={`${company?.name ?? "Cibus Trading"} home`}>
            <span className="brand__mark">
              Cibus<em>Trading</em>
            </span>
            <span className="brand__tagline">{company?.tagline ?? "Quality provisions"}</span>
          </Link>

          <nav className="header-main__nav" aria-label="Main navigation">
            <Link to="/" className="nav-link">
              Home
            </Link>

            <div className="nav-dropdown">
              <button type="button" className="nav-link nav-link--toggle">
                Food Products
                <Icon name="chevronDown" size={16} />
              </button>
              <div className="nav-dropdown__menu">
                <Link to="/products" className="nav-dropdown__item">
                  All Products
                </Link>
                {categories.map((category) => (
                  <Link
                    key={category.id}
                    to={`/products?category=${category.slug}`}
                    className="nav-dropdown__item"
                  >
                    {category.name}
                  </Link>
                ))}
              </div>
            </div>

            <Link to="/page/about" className="nav-link">
              About Us
            </Link>

            <a href="#contact" className="nav-link">
              Contact Us
            </a>
          </nav>

          <HeaderActions />
        </div>
      </div>
    </>
  );
}

/** Below 1200px the category row and inline search cannot both fit. */
function MobileHeader() {
  const { config, toggle } = useUi();
  const company = config?.company;

  return (
    <div className="mobile-header">
      <button
        type="button"
        className="icon-btn"
        aria-label="Open menu"
        onClick={() => toggle("menu")}
      >
        <Icon name="menu" size={24} />
      </button>

      <Link to="/" className="brand" aria-label={`${company?.name ?? "Cibus Trading"} home`}>
        <span className="brand__mark">
          Cibus<em>Trading</em>
        </span>
      </Link>

      <div className="mobile-header__actions">
        <button type="button" className="icon-btn" aria-label="Search" onClick={() => toggle("search")}>
          <Icon name="search" size={22} />
        </button>
        <AccountControl />
        <CartControl />
      </div>
    </div>
  );
}

export default function Header() {
  const { cart } = useCart();
  const [minimised, setMinimised] = useState(false);

  // Keeps the brand, category row and cart reachable without the utility tiers
  // permanently occupying the top of the viewport.
  useEffect(() => {
    const onScroll = () => setMinimised(window.scrollY > 140);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={
        minimised ? "site-header site-header--sticky site-header--minimised" : "site-header"
      }
    >
      <DesktopHeader />
      <MobileHeader />

      {cart?.hasUnavailableItems ? (
        <div className="header-alert">
          <Icon name="alert" size={16} />
          Some items in your cart are no longer available.{" "}
          <Link to="/cart">Review your cart</Link> to continue.
        </div>
      ) : null}
    </header>
  );
}