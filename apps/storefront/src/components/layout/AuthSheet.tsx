import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../Icon.js";
import Sheet from "../ui/Sheet.js";
import { useAuth } from "../../context/AuthContext.js";
import { useCart } from "../../context/CartContext.js";
import { ApiError } from "../../api.js";
import type { Address } from "../../types.js";

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * Sign-in and registration share one sheet with a mode toggle, matching the
 * reference's single "Sign in / Register" entry point.
 */
export default function AuthSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { login, register } = useAuth();
  const { cart } = useCart();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register({ email, password, fullName, ...(phone ? { phone } : {}) });
      }
      // Signing in merges the guest basket, so the cart count behind this sheet
      // is already up to date by the time it closes.
      onClose();
      setPassword("");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const guestCount = cart?.totalQuantity ?? 0;

  return (
    <Sheet open={open} onClose={onClose} title="Account" icon={<Icon name="user" size={20} />}>
      <div className="auth">
        <div className="auth-tabs" role="tablist" aria-label="Account action">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "auth-tab auth-tab--active" : "auth-tab"}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "auth-tab auth-tab--active" : "auth-tab"}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            Register
          </button>
        </div>

        <div className="auth-intro">
          <h3 className="auth-intro__title">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h3>
          <p className="auth-intro__sub">
            {mode === "login"
              ? "Sign in to place orders, save addresses and track deliveries."
              : "Register once and your basket, addresses and orders stay together."}
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {guestCount > 0 ? (
            <p className="demo-hint">
              Your basket has {guestCount} item{guestCount === 1 ? "" : "s"}. Signing in keeps
              everything in it.
            </p>
          ) : null}

          {mode === "register" ? (
            <div className="field">
              <label htmlFor="auth-name">Full name</label>
              <div className="auth-field">
                <span className="auth-field__icon">
                  <Icon name="user" size={18} />
                </span>
                <input
                  id="auth-name"
                  className="input"
                  value={fullName}
                  required
                  autoComplete="name"
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <div className="auth-field">
              <span className="auth-field__icon">
                <Icon name="mail" size={18} />
              </span>
              <input
                id="auth-email"
                className="input"
                type="email"
                value={email}
                required
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          </div>

          {mode === "register" ? (
            <div className="field">
              <label htmlFor="auth-phone">Phone (optional)</label>
              <div className="auth-field">
                <span className="auth-field__icon">
                  <Icon name="phone" size={18} />
                </span>
                <input
                  id="auth-phone"
                  className="input"
                  type="tel"
                  value={phone}
                  autoComplete="tel"
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-field auth-field--password">
              <span className="auth-field__icon">
                <Icon name="shield" size={18} />
              </span>
              <input
                id="auth-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="auth-field__toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              >
                <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>
            {mode === "register" ? (
              <small className="field__hint">At least 8 characters.</small>
            ) : null}
          </div>

          {error ? (
            <div className="notice notice--danger">
              <Icon name="alert" size={18} />
              <p>{error}</p>
            </div>
          ) : null}

          <button type="submit" className="btn btn--lg auth-submit" disabled={busy}>
            {busy ? "Please wait" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-switch">
          You can keep browsing as a guest.{" "}
          <Link to="/products" onClick={onClose}>
            Shop products
          </Link>
        </p>
      </div>
    </Sheet>
  );
}

/** Slide-out navigation for the mobile menu button. */
export function MenuSheet({
  open,
  onClose,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  categories: { id: number; name: string; slug: string; productCount: number }[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Menu" icon={<Icon name="menu" size={20} />} side="left">
      <nav className="menu-list" aria-label="Mobile">
        <Link to="/" onClick={onClose}>
          <Icon name="home" size={18} />
          Home
        </Link>
        <div className="menu-group">
          <span className="menu-list__heading">Food Products</span>
          <Link to="/products" onClick={onClose}>
            <Icon name="chevronRight" size={18} />
            All Products
          </Link>
          {categories.map((category) => (
            <Link key={category.id} to={`/products?category=${category.slug}`} onClick={onClose}>
              <Icon name="chevronRight" size={18} />
              {category.name}
              <em>{category.productCount}</em>
            </Link>
          ))}
        </div>
        <Link to="/page/about" onClick={onClose}>
          <Icon name="info" size={18} />
          About Us
        </Link>
        <a href="#contact" onClick={onClose}>
          <Icon name="phone" size={18} />
          Contact Us
        </a>
      </nav>
    </Sheet>
  );
}

/** Address picker used by the checkout form. */
export function addressToForm(address: Address) {
  return {
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    landmark: address.landmark ?? "",
  };
}