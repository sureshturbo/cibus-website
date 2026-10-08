import { useCallback, useEffect, useState } from "react";
import { adminApi, formatDate } from "../api.js";
import type { Enquiry } from "../types.js";
import { Panel } from "../App.js";
import { StatusPill } from "./Dashboard.js";

const NEXT_STATUSES = ["NEW", "CONTACTED", "CLOSED"] as const;

export default function Enquiries() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await adminApi.enquiries({ pageSize: "100", status: status || "all" });
      setEnquiries(page.items);
      setTotal(page.meta.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load enquiries");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (enquiry: Enquiry, status: string) => {
    setBusyId(enquiry.id);
    try {
      await adminApi.setEnquiryStatus(enquiry.id, status);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the enquiry");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {error ? <p className="banner">{error}</p> : null}

      <div className="toolbar">
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All</option>
            {NEXT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">
          {enquiries.length} shown · {total} total
        </span>
      </div>

      <Panel title="Partner enquiries">
        {enquiries.length === 0 ? (
          <p className="empty">No enquiries yet.</p>
        ) : (
          <ul className="enquiries">
            {enquiries.map((enquiry) => (
              <li key={enquiry.id}>
                <div className="enquiry-head">
                  <strong>{enquiry.businessName}</strong>
                  <StatusPill status={enquiry.status} />
                  <span className="muted">{formatDate(enquiry.createdAt)}</span>
                </div>
                <p className="muted">
                  {enquiry.name} · {enquiry.email} · {enquiry.phone}
                </p>
                <p>{enquiry.message}</p>
                <label>
                  <span>Set status</span>
                  <select
                    value={enquiry.status}
                    disabled={busyId === enquiry.id}
                    onChange={(event) => void update(enquiry, event.target.value)}
                  >
                    {NEXT_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}