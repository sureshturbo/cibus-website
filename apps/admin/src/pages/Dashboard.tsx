import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi, formatDate, formatMoney } from "../api.js";
import type { DashboardSummary } from "../types.js";
import { Panel } from "../App.js";

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void adminApi
      .dashboard()
      .then((summary) => {
        if (!cancelled) setData(summary);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load the dashboard");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="banner">{error}</p>;
  if (!data) return <p className="loading">Loading dashboard…</p>;

  const currency = data.revenue.currency;

  const stats = [
    { label: "Orders", value: String(data.orders.total), note: `${data.orders.last7Days} in last 7 days` },
    { label: "Live order value", value: formatMoney(data.revenue.liveOrderValue, currency), note: "Not yet collected" },
    { label: "Delivered value", value: formatMoney(data.revenue.deliveredValue, currency), note: "Lifetime" },
    { label: "Average order", value: formatMoney(data.revenue.averageOrderValue, currency), note: "All orders" },
    { label: "Active products", value: `${data.catalogue.activeProducts}/${data.catalogue.totalProducts}`, note: `${data.catalogue.outOfStock} out of stock` },
    { label: "Low stock", value: String(data.attention.lowStockCount), note: "At or below threshold" },
  ];

  return (
    <>
      <p className="hint">Generated {formatDate(data.generatedAt)}</p>

      <div className="stats">
        {stats.map((stat) => (
          <article key={stat.label} className="stat">
            <p className="stat-label">{stat.label}</p>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-note">{stat.note}</p>
          </article>
        ))}
      </div>

      {/*
        Payment integration is out of scope, so this value is a pipeline figure
        and must never be read as money in the bank. The API states this with an
        isCommittedRevenue flag and the UI repeats it rather than implying cash.
      */}
      {!data.revenue.isCommittedRevenue ? (
        <p className="notice">
          Revenue figures are order values only. Online payment is not integrated, so nothing here is settled
          revenue — orders are confirmed manually.
        </p>
      ) : null}

      <div className="split">
        <Panel title="Recent orders">
          {data.recentOrders.length === 0 ? (
            <p className="empty">No orders yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to="/orders">{order.orderNumber}</Link>
                    </td>
                    <td>{order.customerName}</td>
                    <td>
                      <StatusPill status={order.status} />
                    </td>
                    <td>{formatMoney(order.total, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Needs restocking">
          {data.attention.lowStockItems.length === 0 ? (
            <p className="empty">Nothing is below its threshold.</p>
          ) : (
            <ul className="plain">
              {data.attention.lowStockItems.map((item) => (
                <li key={item.id}>
                  <Link to="/products">{item.name}</Link>
                  <span className="muted">
                    {item.stockQuantity} / {item.unitLabel} left (threshold {item.lowStockThreshold})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Fulfilment pipeline">
        <ul className="plain">
          {Object.entries(data.fulfilment).map(([stage, count]) => (
            <li key={stage}>
              <span className="muted">{stage.replace(/([A-Z])/g, " $1").trim()}</span>
              <strong>{count}</strong>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status.toLowerCase().replace(/_/g, "-")}`}>{status.replace(/_/g, " ")}</span>;
}