import { useCallback, useEffect, useState } from "react";
import { adminApi, formatDate, formatMoney } from "../api.js";
import type { AdminOrder } from "../types.js";
import { Panel } from "../App.js";
import { StatusPill } from "./Dashboard.js";

/**
 * Mirrors ORDER_STATUS_TRANSITIONS from @cibus/shared. The server rejects an
 * illegal move regardless, but offering only legal options means the operator
 * is never invited to do something that will fail.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

export default function Orders() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = { pageSize: "100" };
      if (status) params.status = status;
      if (debouncedSearch) params.search = debouncedSearch;
      const page = await adminApi.orders(params);
      setOrders(page.items);
      setTotal(page.meta.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load orders");
    }
  }, [status, debouncedSearch]);

  // The list is server-filtered, so keystrokes are debounced rather than fired
  // one request per character.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (order: AdminOrder, next: string) => {
    setBusyId(order.id);
    try {
      await adminApi.setOrderStatus(order.id, next);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the order");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <label>
          <span>Search</span>
          <input
            type="search"
            value={search}
            placeholder="Order number, name, email or phone"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(TRANSITIONS).map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <span className="hint">
          {orders.length} shown · {total} total
        </span>
      </div>

      {error ? <p className="banner">{error}</p> : null}

      <Panel title="Orders">
        <table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Placed</th>
              <th scope="col">Customer</th>
              <th scope="col">Items</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Move to</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const options = TRANSITIONS[order.status] ?? [];
              return (
                <tr key={order.id}>
                  <td className="mono">{order.orderNumber}</td>
                  <td>{formatDate(order.createdAt)}</td>
                  <td>
                    {order.customerName}
                    <span className="muted"> {order.customerEmail}</span>
                  </td>
                  <td>{order.itemCount}</td>
                  <td>{formatMoney(order.total)}</td>
                  <td>
                    <StatusPill status={order.status} />
                  </td>
                  <td>
                    {options.length === 0 ? (
                      <span className="muted">Final</span>
                    ) : (
                      <select
                        value=""
                        disabled={busyId === order.id}
                        aria-label={`Change status for ${order.orderNumber}`}
                        onChange={(event) => {
                          if (event.target.value) void changeStatus(order, event.target.value);
                        }}
                      >
                        <option value="">Choose…</option>
                        {options.map((value) => (
                          <option key={value} value={value}>
                            {value.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 0 ? <p className="empty">No orders match that filter.</p> : null}
      </Panel>
    </>
  );
}