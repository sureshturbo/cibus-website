import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.js";
import QuantityStepper from "../components/ui/QuantityStepper.js";
import { api, formatMoney, PLACEHOLDER_IMAGES } from "../api.js";
import { useCart } from "../context/CartContext.js";
import { useUi } from "../context/UiContext.js";
import type { CartPreview } from "../types.js";

export default function CartPage() {
  const { cart, busy, setQuantity, remove, refresh } = useCart();
  const { open } = useUi();
  const navigate = useNavigate();

  const [offerCode, setOfferCode] = useState("");
  const [preview, setPreview] = useState<CartPreview | null>(null);
  const [applying, setApplying] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setOfferCode("");
    setOfferError(null);
  }, [cart?.totalQuantity]);

  /**
   * Totals come from `previewCart`, never from adding the line totals up here.
   * Discount rules are the server's, so the summary must be the server's too.
   */
  const applyOffer = async () => {
    const code = offerCode.trim();
    if (!code) return;
    setApplying(true);
    setOfferError(null);
    try {
      setPreview(await api.cartPreview(code));
    } catch {
      setOfferError("That code is not valid for this order.");
    } finally {
      setApplying(false);
    }
  };

  if (!cart) return <div className="container section" aria-busy="true" />;

  if (cart.items.length === 0) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="cart" size={30} />
          </div>
          <h1>Your cart is empty</h1>
          <p>Nothing here yet. Browse the catalogue and add what you need.</p>
          <Link to="/products" className="btn btn--lg">
            Start shopping
            <Icon name="arrowRight" size={17} />
          </Link>
        </div>
      </div>
    );
  }

  const total = preview?.estimatedTotal ?? cart.subtotal;
  const blocked = !cart.allPurchasable;

  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1 className="page-head__title">Shopping cart</h1>
        </div>
      </div>

      <div className="container section">
        {cart.issues.length > 0 ? (
          <div className="notice notice--warn notice--block">
            <Icon name="alert" size={20} />
            <div>
              {cart.issues.map((issue) => (
                <p key={issue}>{issue}</p>
              ))}
            </div>
          </div>
        ) : null}

        <div className="cart-layout">
          <div>
            <div className="cart-lines">
              {cart.items.map((line) => (
                <div
                  key={line.productId}
                  className={line.purchasable ? "cart-line" : "cart-line cart-line--blocked"}
                >
                  <Link to={`/product/${line.slug}`}>
                    <img
                      className="cart-line__media"
                      src={line.image?.url ?? PLACEHOLDER_IMAGES.product}
                      alt={line.image?.altText ?? line.name}
                    />
                  </Link>

                  <div className="cart-line__info">
                    <Link to={`/product/${line.slug}`} className="cart-line__name">
                      {line.name}
                    </Link>
                    <div className="cart-line__meta">
                      {line.sku} &middot; {formatMoney(line.unitPrice)} per {line.unitLabel}
                    </div>
                    {line.issue ? <span className="cart-line__issue">{line.issue}</span> : null}

                    <div className="cart-line__controls">
                      <QuantityStepper
                        value={line.quantity}
                        min={1}
                        max={Math.max(1, line.stockQuantity)}
                        disabled={busy || !line.purchasable}
                        label={`Quantity of ${line.name}`}
                        onChange={(next) => void setQuantity(line.productId, next)}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${line.name}`}
                        disabled={busy}
                        onClick={() => void remove(line.productId)}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </div>
                  </div>

                  <span className="cart-line__total">{formatMoney(line.lineTotal)}</span>
                </div>
              ))}
            </div>

            <div className="cart-actions">
              <Link to="/products" className="btn btn--ghost">
                <Icon name="chevronLeft" size={17} />
                Continue shopping
              </Link>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void refresh()}>
                <Icon name="refresh" size={16} />
                Recalculate
              </button>
            </div>
          </div>

          <aside className="cart-summary">
            <h2 className="panel__title">Order summary</h2>

            <div className="cart-summary__row">
              <span>Subtotal</span>
              <strong>{formatMoney(cart.subtotal)}</strong>
            </div>

            {cart.savings > 0 ? (
              <div className="cart-summary__row">
                <span>Product savings</span>
                <strong className="card__stock--in">-{formatMoney(cart.savings)}</strong>
              </div>
            ) : null}

            {preview && preview.discountTotal > 0 ? (
              <>
                <div className="cart-summary__row">
                  <span>Offer discount</span>
                  <strong className="card__stock--in">-{formatMoney(preview.discountTotal)}</strong>
                </div>
                {preview.appliedOffers.map((offer) => (
                  <div key={offer.offerId} className="cart-summary__row">
                    <span className="applied-offer">
                      <Icon name="tag" size={15} />
                      {offer.code ?? offer.offerName}
                    </span>
                    <strong>-{formatMoney(offer.discount)}</strong>
                  </div>
                ))}
              </>
            ) : null}

            <div className="cart-summary__row cart-summary__total">
              <span>Estimated total</span>
              <span>{formatMoney(total)}</span>
            </div>

            {/* Offer code */}
            <div className="offer-box">
              {preview && !preview.offerRejections.length ? (
                <p className="offer-box__ok">
                  <Icon name="check" size={16} />
                  Offer applied
                  {preview.appliedOffers.length
                    ? `: ${preview.appliedOffers.map((offer) => offer.code ?? offer.offerName).join(", ")}`
                    : ""}
                </p>
              ) : null}

              {preview?.offerRejections.map((rejection) => (
                <p key={rejection.offerId} className="offer-box__bad">
                  <Icon name="alert" size={16} />
                  {rejection.offerName}: {rejection.reason}
                </p>
              ))}

              <div className="offer-box__field">
                <label className="sr-only" htmlFor="offer">
                  Offer code
                </label>
                <input
                  id="offer"
                  value={offerCode}
                  placeholder="Offer code"
                  onChange={(event) => setOfferCode(event.target.value.toUpperCase())}
                />
                <button type="button" className="btn btn--sm" disabled={applying} onClick={() => void applyOffer()}>
                  {applying ? "Checking" : "Apply"}
                </button>
              </div>
              {offerError ? <p className="offer-box__bad">{offerError}</p> : null}
            </div>

            {blocked ? (
              <p className="notice notice--warn">
                <Icon name="alert" size={18} />
                Remove or replace the unavailable items before checking out.
              </p>
            ) : (
              <button
                type="button"
                className="btn btn--block btn--lg"
                onClick={() => navigate("/checkout")}
              >
                Proceed to checkout
                <Icon name="arrowRight" size={18} />
              </button>
            )}

            <button type="button" className="btn btn--link btn--block" onClick={() => open("auth")}>
              Sign in for faster checkout
            </button>

            <p className="cart-summary__note">
              <Icon name="shield" size={16} />
              No payment is taken online. Our team reviews every order and contacts you to confirm
              it and arrange payment.
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}