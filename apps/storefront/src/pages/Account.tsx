import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.js";
import { api, formatDate, formatMoney } from "../api.js";
import { useAuth } from "../context/AuthContext.js";
import { useUi } from "../context/UiContext.js";
import { useToast } from "../components/ui/Toast.js";
import type { Address, Order, OrderSummary, PageMeta } from "../types.js";

type Tab = "orders" | "details" | "addresses";

function OrdersTab() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .orders(1)
      .then((result) => {
        setOrders(result.items);
        setMeta(result.meta);
      })
      .catch(() => setError("We could not load your orders."))
      .finally(() => setLoading(false));
  }, []);

  const expand = async (id: number) => {
    if (open?.id === id) {
      setOpen(null);
      return;
    }
    try {
      setOpen(await api.order(id));
    } catch {
      setError("We could not load that order.");
    }
  };

  if (loading) return <div className="panel" aria-busy="true" />;

  if (error && orders.length === 0) {
    return (
      <div className="notice notice--danger">
        <Icon name="alert" size={18} />
        <p>{error}</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">
          <Icon name="box" size={30} />
        </div>
        <h2>No orders yet</h2>
        <p>When you place an order it will appear here with its status.</p>
        <Link to="/products" className="btn">
          Browse products
        </Link>
      </div>
    );
  }

  return (
    <>
      {orders.map((order) => (
        <div key={order.id} className="order-block">
          <div className="order-row">
            <span>
              <span className="order-row__number">{order.orderNumber}</span>
              <br />
              <span className="cart-line__meta">
                {formatDate(order.createdAt)} &middot; {order.itemCount} item
                {order.itemCount === 1 ? "" : "s"}
              </span>
            </span>
            <span className={order.status === "CANCELLED" ? "status status--muted" : "status"}>
              {order.status.replace(/_/g, " ").toLowerCase()}
            </span>
            <strong>{formatMoney(order.total)}</strong>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void expand(order.id)}>
              {open?.id === order.id ? "Hide" : "Details"}
            </button>
          </div>

          {open?.id === order.id ? (
            <div className="order-detail">
              <ul className="checkout-lines">
                {open.items.map((item) => (
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
                  <dd>{formatMoney(open.subtotal)}</dd>
                </div>
                {open.discountTotal > 0 ? (
                  <div className="detail__meta-row">
                    <dt>Discount</dt>
                    <dd>-{formatMoney(open.discountTotal)}</dd>
                  </div>
                ) : null}
                <div className="detail__meta-row">
                  <dt>Total</dt>
                  <dd>
                    <strong>{formatMoney(open.total)}</strong>
                  </dd>
                </div>
              </dl>

              <p className="cart-line__meta">
                {open.fulfilmentMethod === "DELIVERY"
                  ? `Delivering to ${open.addressLine1}, ${open.addressCity} ${open.addressPostalCode}`
                  : "Collection from our premises"}
              </p>

              <a href={api.invoiceUrl(open.id)} className="btn btn--ghost btn--sm" target="_blank" rel="noreferrer">
                View invoice
              </a>
            </div>
          ) : null}
        </div>
      ))}

      {meta && meta.totalPages > 1 ? (
        <p className="cart-line__meta">
          Showing {orders.length} of {meta.total} orders.
        </p>
      ) : null}
    </>
  );
}

function DetailsTab() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone ?? "");
    }
  }, [user]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.updateProfile({ fullName, ...(phone ? { phone } : {}) });
      await refresh();
      toast.push("Your details have been updated.");
    } catch {
      toast.push("We could not save those details.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel" onSubmit={save}>
      <h2 className="panel__title">Your details</h2>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="ac-name">Full name</label>
          <input id="ac-name" required value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="ac-phone">Phone</label>
          <input id="ac-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </div>

        <div className="field form-grid--full">
          <label htmlFor="ac-email">Email</label>
          <input id="ac-email" value={user?.email ?? ""} disabled readOnly />
          <small>Contact us if you need this changed.</small>
        </div>
      </div>

      <button type="submit" className="btn" disabled={saving}>
        {saving ? "Saving" : "Save changes"}
      </button>
    </form>
  );
}

function AddressesTab() {
  const toast = useToast();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    void api
      .addresses()
      .then(setAddresses)
      .catch(() => toast.push("We could not load your addresses.", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (id: number) => {
    try {
      await api.deleteAddress(id);
      toast.push("Address removed.");
      load();
    } catch {
      toast.push("We could not remove that address.", "error");
    }
  };

  if (loading) return <div className="panel" aria-busy="true" />;

  if (addresses.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">
          <Icon name="mapPin" size={30} />
        </div>
        <h2>No saved addresses</h2>
        <p>Addresses you use at checkout can be saved here for next time.</p>
      </div>
    );
  }

  return (
    <div>
      {addresses.map((address) => (
        <AddressRow key={address.id} {...address} onRemove={() => void remove(address.id)} />
      ))}
    </div>
  );
}

function AddressRow({
  id,
  label,
  fullName,
  line1,
  line2,
  city,
  state,
  postalCode,
  landmark,
  isDefault,
  onRemove,
}: Address & { onRemove: () => void }) {
  void id;

  return (
    <div className="panel address-card">
      <div className="address-card__head">
        <strong>{label}</strong>
        {isDefault ? <span className="badge badge--sale">Default</span> : null}
      </div>
      <p>
        {fullName}
        <br />
        {line1}
        {line2 ? (
          <>
            <br />
            {line2}
          </>
        ) : null}
        <br />
        {city}, {state} {postalCode}
        {landmark ? ` (${landmark})` : ""}
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}>
        <Icon name="trash" size={16} />
        Remove
      </button>
    </div>
  );
}

export default function Account() {
  const { user, ready, logout } = useAuth();
  const { open } = useUi();
  const navigate = useNavigate();
  const location = useLocation();

  const tab = (new URLSearchParams(location.search).get("tab") as Tab | null) ?? "orders";

  useEffect(() => {
    if (ready && !user) open("auth");
  }, [ready, user, open]);

  if (!ready) return <div className="container section" aria-busy="true" />;

  if (!user) {
    return (
      <div className="container section">
        <div className="empty-state">
          <h1>Sign in to continue</h1>
          <p>Your orders and saved details live behind your account.</p>
          <button type="button" className="btn" onClick={() => open("auth")}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: "box" | "user" | "mapPin" }[] = [
    { id: "orders", label: "My orders", icon: "box" },
    { id: "details", label: "My details", icon: "user" },
    { id: "addresses", label: "Addresses", icon: "mapPin" },
  ];

  return (
    <>
      <div className="page-head">
        <div className="container">
          <h1 className="page-head__title">Hello, {user.fullName.split(" ")[0]}</h1>
        </div>
      </div>

      <div className="container section">
        <div className="account-layout">
          <nav className="account-nav" aria-label="Account sections">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={tab === entry.id ? "true" : undefined}
                onClick={() => navigate(`/account?tab=${entry.id}`)}
              >
                <Icon name={entry.icon} size={17} />
                {entry.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate("/"));
              }}
            >
              <Icon name="logout" size={17} />
              Sign out
            </button>
          </nav>

          <div>
            {tab === "orders" ? <OrdersTab /> : null}
            {tab === "details" ? <DetailsTab /> : null}
            {tab === "addresses" ? <AddressesTab /> : null}
          </div>
        </div>
      </div>
    </>
  );
}