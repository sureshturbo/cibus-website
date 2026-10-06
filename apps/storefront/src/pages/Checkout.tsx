import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.js";
import { ApiError, api, formatMoney, PLACEHOLDER_IMAGES } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { useCart } from "../context/CartContext.js";
import { useUi } from "../context/UiContext.js";
import type { CartPreview, FulfilmentMethod } from "../types.js";

interface AddressForm {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  landmark: string;
}

const EMPTY: AddressForm = {
  fullName: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  landmark: "",
};

export default function Checkout() {
  const { user, ready } = useAuth();
  const { cart, refresh } = useCart();
  const { open, config } = useUi();
  const navigate = useNavigate();

  const [method, setMethod] = useState<FulfilmentMethod>("DELIVERY");
  const [address, setAddress] = useState<AddressForm>(EMPTY);
  const [notes, setNotes] = useState("");
  const [offerCode, setOfferCode] = useState("");
  const [preview, setPreview] = useState<CartPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = !cart || cart.items.length === 0;

  useEffect(() => {
    if (user) {
      setAddress((current) => (current.fullName ? current : { ...current, fullName: user.fullName }));
    }
  }, [user]);

  // A signed-out shopper is sent to sign in, then merged back onto this page.
  useEffect(() => {
    if (ready && !user) open("auth");
  }, [ready, user, open]);

  const loadPreview = useCallback(async (code?: string) => {
    try {
      // /shop/checkout/preview re-validates the whole checkout body, so it is
      // useless for typing an offer code. The cart preview takes the code as a
      // query param and returns the same priced preview shape.
      setPreview(await api.cartPreview(code));
    } catch {
      setPreview(null);
    }
  }, []);

  useEffect(() => {
    if (!empty) void loadPreview(offerCode.trim() || undefined);
  }, [empty, offerCode, loadPreview]);

  if (!ready) return <div className="container section" aria-busy="true" />;

  if (empty) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state__icon">
            <Icon name="cart" size={30} />
          </div>
          <h1>Your cart is empty</h1>
          <p>Add something to your cart before checking out.</p>
          <Link to="/products" className="btn">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  const blocked = !cart.allPurchasable;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await api.checkout({
        email: user?.email ?? "",
        fullName: address.fullName,
        phone: address.phone,
        fulfilmentMethod: method,
        address: {
          fullName: address.fullName,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2 || undefined,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          landmark: address.landmark || undefined,
        },
        deliveryNotes: notes || undefined,
        offerCode: offerCode.trim() || undefined,
        // Regenerated per attempt so a double click cannot place two orders.
        idempotencyKey: crypto.randomUUID(),
      });

      await refresh();
      navigate(`/order-confirmation/${result.orderId}`, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "UNAUTHENTICATED") {
        open("auth");
        setError("Please sign in to place your order.");
      } else {
        setError(caught instanceof Error ? caught.message : "We could not place that order.");
      }
      setSubmitting(false);
    }
  };

  const total = preview?.estimatedTotal ?? cart.subtotal;

  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1 className="page-head__title">Checkout</h1>
        </div>
      </div>

      <div className="container section">
        {/* One form wraps both columns so the summary's submit button validates
            the address fields natively rather than duplicating that logic. */}
        <form className="checkout" onSubmit={submit}>
          <div>
            <section className="panel">
              <h2 className="panel__title">Contact</h2>
              <p className="checkout__email">
                Signed in as <strong>{user?.email}</strong>. Order updates go to this address.
              </p>
            </section>

            <section className="panel">
              <h2 className="panel__title">How would you like this order?</h2>
              <div className="method-picker">
                {(["DELIVERY", "PICKUP"] as FulfilmentMethod[]).map((option) => (
                  <label key={option} className="method-option">
                    <input
                      type="radio"
                      name="method"
                      checked={method === option}
                      onChange={() => setMethod(option)}
                    />
                    <span>
                      <Icon name={option === "DELIVERY" ? "truck" : "mapPin"} size={20} />
                      <b>{option === "DELIVERY" ? "Deliver to me" : "Collect from us"}</b>
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {/* The schema requires an address even for pickup, so a collection
                point address is shown rather than sending an invalid body. */}
            <section className="panel">
              <h2 className="panel__title">
                {method === "DELIVERY" ? "Delivery address" : "Collection details"}
              </h2>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="co-name">Full name</label>
                  <input
                    id="co-name"
                    required
                    autoComplete="name"
                    value={address.fullName}
                    onChange={(event) => setAddress({ ...address, fullName: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="co-phone">Phone</label>
                  <input
                    id="co-phone"
                    required
                    type="tel"
                    autoComplete="tel"
                    value={address.phone}
                    onChange={(event) => setAddress({ ...address, phone: event.target.value })}
                  />
                </div>

                <div className="field form-grid--full">
                  <label htmlFor="co-line1">Address line 1</label>
                  <input
                    id="co-line1"
                    required
                    autoComplete="address-line1"
                    value={address.line1}
                    onChange={(event) => setAddress({ ...address, line1: event.target.value })}
                  />
                </div>

                <div className="field form-grid--full">
                  <label htmlFor="co-line2">Address line 2 (optional)</label>
                  <input
                    id="co-line2"
                    autoComplete="address-line2"
                    value={address.line2}
                    onChange={(event) => setAddress({ ...address, line2: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="co-city">City</label>
                  <input
                    id="co-city"
                    required
                    autoComplete="address-level2"
                    value={address.city}
                    onChange={(event) => setAddress({ ...address, city: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="co-state">State</label>
                  <input
                    id="co-state"
                    required
                    autoComplete="address-level1"
                    value={address.state}
                    onChange={(event) => setAddress({ ...address, state: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="co-postal">Postal code</label>
                  <input
                    id="co-postal"
                    required
                    autoComplete="postal-code"
                    value={address.postalCode}
                    onChange={(event) => setAddress({ ...address, postalCode: event.target.value })}
                  />
                </div>

                <div className="field">
                  <label htmlFor="co-landmark">Landmark (optional)</label>
                  <input
                    id="co-landmark"
                    value={address.landmark}
                    onChange={(event) => setAddress({ ...address, landmark: event.target.value })}
                  />
                </div>

                <div className="field form-grid--full">
                  <label htmlFor="co-notes">Notes for our team (optional)</label>
                  <textarea
                    id="co-notes"
                    rows={3}
                    maxLength={500}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </div>
              </div>
            </section>

            {error ? (
              <div className="notice notice--danger notice--block">
                <Icon name="alert" size={20} />
                <p>{error}</p>
              </div>
            ) : null}
          </div>

          <aside className="cart-summary">
            <h2 className="panel__title">Your order</h2>

            <ul className="checkout-lines">
              {cart.items.map((line) => (
                <li key={line.productId}>
                  <img src={line.image?.url ?? PLACEHOLDER_IMAGES.product} alt="" loading="lazy" />
                  <span className="checkout-lines__name">
                    {line.name}
                    <em>&times;{line.quantity}</em>
                  </span>
                  <span>{formatMoney(line.lineTotal)}</span>
                </li>
              ))}
            </ul>

            <div className="cart-summary__row">
              <span>Subtotal</span>
              <strong>{formatMoney(cart.subtotal)}</strong>
            </div>

            {preview && preview.discountTotal > 0 ? (
              <div className="cart-summary__row">
                <span>Discount</span>
                <strong className="card__stock--in">-{formatMoney(preview.discountTotal)}</strong>
              </div>
            ) : null}

            <div className="cart-summary__row cart-summary__total">
              <span>Total</span>
              <span>{formatMoney(total)}</span>
            </div>

            {config?.offerCodesEnabled ? (
              <div className="offer-box">
                <div className="offer-box__field">
                  <label className="sr-only" htmlFor="co-offer">
                    Offer code
                  </label>
                  <input
                    id="co-offer"
                    value={offerCode}
                    placeholder="Offer code"
                    onChange={(event) => setOfferCode(event.target.value.toUpperCase())}
                  />
                </div>
                {preview?.offerRejections.map((rejection) => (
                  <p key={rejection.offerId} className="offer-box__bad">
                    <Icon name="alert" size={16} />
                    {rejection.reason}
                  </p>
                ))}
              </div>
            ) : null}

            {blocked ? (
              <p className="notice notice--warn">
                <Icon name="alert" size={18} />
                Your cart has unavailable items.{" "}
                <Link to="/cart">Review cart</Link>
              </p>
            ) : (
              <button type="submit" className="btn btn--block btn--lg" disabled={submitting}>
                {submitting ? "Placing order" : "Place order"}
              </button>
            )}

            <p className="cart-summary__note">
              <Icon name="info" size={16} />
              {config?.paymentNotice ??
                "Online payment is not yet available. Our team will contact you to confirm your order and arrange payment."}
            </p>

            <Link to="/cart" className="btn btn--link btn--block">
              Back to cart
            </Link>
          </aside>
        </form>
      </div>
    </>
  );
}