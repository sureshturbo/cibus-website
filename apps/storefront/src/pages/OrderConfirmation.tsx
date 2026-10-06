import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon.js";
import { api, formatDate, formatMoney } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import type { OrderConfirmation } from "../types.js";

export default function OrderConfirmationPage() {
  const { id = "" } = useParams();
  const { ready, user } = useAuth();
  const [data, setData] = useState<OrderConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void api
      .orderConfirmation(Number(id))
      .then(setData)
      .catch(() => setError("We could not load that order."));
  }, [id, user]);

  if (!ready || (!user && ready)) {
    return (
      <div className="container section">
        <div className="empty-state">
          <h1>Sign in to view this order</h1>
          <Link to="/" className="btn">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container section">
        <div className="notice notice--danger">
          <Icon name="alert" size={20} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return <div className="container section" aria-busy="true" />;

  const { order, invoice } = data;

  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1 className="page-head__title">Thank you for your order</h1>
        </div>
      </div>

      <div className="container section">
        <div className="confirm">
          <span className="confirm-mark">
            <Icon name="check" size={34} />
          </span>

          <h2 className="confirm__title">Order {order.orderNumber} is with us</h2>
          <p className="confirm__lede">{order.notice}</p>

          <div className="confirm__meta">
            <span>Placed {formatDate(order.placedAt)}</span>
            <span className={order.status === "CANCELLED" ? "status status--muted" : "status"}>
              {order.status.replace(/_/g, " ").toLowerCase()}
            </span>
          </div>
        </div>

        <div className="cart-layout">
          <div className="panel">
            <h3 className="panel__title">Items</h3>

            <ul className="checkout-lines">
              {order.items.map((item) => (
                <li key={item.id}>
                  <span className="checkout-lines__name">
                    {item.productName}
                    <em>&times;{item.quantity}</em>
                  </span>
                  <span>{formatMoney(item.lineTotal)}</span>
                </li>
              ))}
            </ul>

            <dl className="detail__meta-list">
              <div className="detail__meta-row">
                <dt>Subtotal</dt>
                <dd>{formatMoney(order.subtotal)}</dd>
              </div>
              {order.discountTotal > 0 ? (
                <div className="detail__meta-row">
                  <dt>Discount</dt>
                  <dd>-{formatMoney(order.discountTotal)}</dd>
                </div>
              ) : null}
              <div className="detail__meta-row">
                <dt>Total</dt>
                <dd>
                  <strong>{formatMoney(order.total)}</strong>
                </dd>
              </div>
            </dl>
          </div>

          <aside className="panel">
            <h3 className="panel__title">
              {order.address.line1 ? "Delivery address" : "Order details"}
            </h3>
            <p className="cart-line__meta">
              {order.address.line1}
              <br />
              {order.address.line2}
              <br />
              {order.address.city}, {order.address.state} {order.address.postalCode}
            </p>

            {invoice ? (
              <>
                <p className="cart-line__meta">
                  Invoice <strong>{invoice.invoiceNumber}</strong>
                </p>
                <a
                  href={api.invoiceUrl(order.id)}
                  className="btn btn--ghost btn--sm"
                  target="_blank"
                  rel="noreferrer"
                >
                  View invoice
                </a>
              </>
            ) : null}

            <Link to="/products" className="btn btn--block">
              Continue shopping
            </Link>
            <Link to="/account/orders" className="btn btn--link btn--block">
              View all orders
            </Link>
          </aside>
        </div>
      </div>
    </>
  );
}