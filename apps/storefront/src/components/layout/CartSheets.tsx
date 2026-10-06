import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../Icon.js";
import { api, discountPercent, formatMoney, PLACEHOLDER_IMAGES, primaryImageOf } from "../../api.js";
import { useCart } from "../../context/CartContext.js";
import Sheet from "../ui/Sheet.js";
import QuantityStepper from "../ui/QuantityStepper.js";
import type { Product } from "../../types.js";

/**
 * Mini-cart sheet. Line prices come from the cart the server returned, never
 * recomputed here, so this and the cart page cannot disagree.
 */
export default function MiniCart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cart, busy, setQuantity, remove } = useCart();

  if (!open) return null;

  if (!cart || cart.items.length === 0) {
    return (
      <Sheet open onClose={onClose} title="Your cart" icon={<Icon name="cart" size={20} />}>
        <div className="mini-cart__empty">
          <Icon name="cart" size={40} />
          <h3>Your cart is empty</h3>
          <p className="muted">Browse the catalogue and add what you need.</p>
          <Link to="/products" className="btn btn--block" onClick={onClose}>
            Start shopping
          </Link>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Your cart (${cart.totalQuantity})`}
      icon={<Icon name="cart" size={20} />}
      footer={
        <>
          <div className="mini-cart__totals">
            <div className="cart-summary__row">
              <span>Subtotal</span>
              <strong>{formatMoney(cart.subtotal)}</strong>
            </div>
            {cart.savings > 0 ? (
              <span className="mini-cart__saving">You save {formatMoney(cart.savings)}</span>
            ) : null}
          </div>
          <Link to="/checkout" className="btn btn--block" onClick={onClose}>
            Proceed to checkout
          </Link>
          <Link to="/cart" className="btn btn--ghost btn--block" onClick={onClose}>
            View full cart
          </Link>
        </>
      }
    >
      {cart.issues.length > 0 ? (
        <div className="notice notice--warn">
          <Icon name="alert" size={18} />
          <div>
            {cart.issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        </div>
      ) : null}

      {cart.items.map((line) => (
        <div key={line.productId} className="mini-cart__line">
          {line.image ? (
            <img className="mini-cart__thumb" src={line.image.url} alt={line.image.altText ?? line.name} />
          ) : (
            <span className="mini-cart__thumb mini-cart__thumb--empty">
              <Icon name="box" size={18} />
            </span>
          )}

          <div>
            <Link to={`/product/${line.slug}`} onClick={onClose} className="mini-cart__name">
              {line.name}
            </Link>
            {line.issue ? <span className="cart-line__issue">{line.issue}</span> : null}

            <div className="mini-cart__row">
              <QuantityStepper
                value={line.quantity}
                min={1}
                max={99}
                disabled={busy || !line.purchasable}
                label={`Quantity of ${line.name}`}
                onChange={(next) => void setQuantity(line.productId, next)}
              />

              <strong>{formatMoney(line.lineTotal)}</strong>

              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${line.name}`}
                disabled={busy}
                onClick={() => void remove(line.productId)}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </Sheet>
  );
}

/** Full-width search overlay with live suggestions, as in the reference. */
export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();
  const ticket = useRef(0);

  useEffect(() => {
    if (!open) {
      setTerm("");
      setResults([]);
      setSearched(false);
    }
  }, [open]);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }

    // Guard against a slow earlier response overwriting a newer one.
    const current = ++ticket.current;
    const timer = window.setTimeout(() => {
      void api
        .suggest(query, 6)
        .then((result) => {
          if (current !== ticket.current) return;
          setResults(result.items);
          setSearched(true);
        })
        .catch(() => undefined);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [term]);

  const submit = () => {
    const query = term.trim();
    if (!query) return;
    onClose();
    navigate(`/products?search=${encodeURIComponent(query)}`);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Search" icon={<Icon name="search" size={20} />}>
      <form
        className="search-field"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="search-sheet">
          Search for products
        </label>
        <input
          id="search-sheet"
          className="input"
          type="search"
          autoFocus
          value={term}
          placeholder="Search for products"
          onChange={(event) => setTerm(event.target.value)}
        />
        <button type="submit" className="search-field__submit" aria-label="Search">
          <Icon name="arrowRight" size={18} />
        </button>
      </form>

      {term.trim().length < 2 ? (
        <p className="muted" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)" }}>
          Type at least two characters to see suggestions.
        </p>
      ) : results.length > 0 ? (
        results.map((product) => {
          const percent = discountPercent(product.price, product.compareAtPrice);
          const image = primaryImageOf(product);

          return (
            <Link key={product.id} to={`/product/${product.slug}`} className="search-result" onClick={onClose}>
              {image ? (
            <img className="search-result__thumb" src={image?.url ?? PLACEHOLDER_IMAGES.product} alt="" loading="lazy" />
              ) : (
                <span className="search-result__thumb search-result__thumb--empty">
                  <Icon name="box" size={16} />
                </span>
              )}
              <span>
                <span className="search-result__name">{product.name}</span>
                <br />
                <span className="search-result__price">
                  {formatMoney(product.price)}
                  {percent ? ` · -${percent}%` : ""}
                </span>
              </span>
            </Link>
          );
        })
      ) : searched ? (
        <p className="muted" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)" }}>
          No products matched &ldquo;{term.trim()}&rdquo;.
        </p>
      ) : null}
    </Sheet>
  );
}