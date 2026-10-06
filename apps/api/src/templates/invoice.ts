import { formatMinor, type InvoiceStatus, type OrderStatus } from "@cibus/shared";

/**
 * Printable invoice HTML.
 *
 * Rendered from invoice and order snapshots only, so what a customer prints
 * today matches what they printed last year.
 *
 * Every interpolated value is HTML-escaped. Product names and delivery notes are
 * customer-supplied, and an unescaped `&lt;script&gt;` in a product name would
 * otherwise execute in the browser of whoever opens the invoice.
 */

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(minor: number): string {
  return formatMinor(minor, "INR");
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pending review",
  CONFIRMED: "Confirmed",
  PROCESSING: "Being prepared",
  READY: "Ready for dispatch",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const INVOICE_BADGE: Record<InvoiceStatus, { label: string; background: string; color: string }> = {
  DRAFT: { label: "Draft", background: "#eef1ff", color: "#4b567a" },
  ISSUED: { label: "Issued", background: "#fff4d6", color: "#8a5a00" },
  PAID: { label: "Paid", background: "#d8f5e8", color: "#0f6b45" },
  VOID: { label: "Void", background: "#ffe2e2", color: "#9b1c1c" },
};

export function renderInvoiceHtml(view: {
  invoiceNumber: string;
  issuedAt: Date;
  status: InvoiceStatus;
  issuer: { name: string; address: string; email: string; phone: string };
  customer: { name: string; email: string; phone: string; address: string };
  order: { number: string; status: OrderStatus; placedAt: Date };
  lines: Array<{
    description: string;
    sku: string;
    unitLabel: string;
    unitPrice: number;
    quantity: number;
    discount: number;
    total: number;
  }>;
  subtotal: number;
  discountTotal: number;
  total: number;
  notes: string[];
}): string {
  const badge = INVOICE_BADGE[view.status];
  const issuedOn = view.issuedAt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const lineRows = view.lines
    .map(
      (line) => `
        <tr>
          <td class="desc">
            <strong>${escapeHtml(line.description)}</strong>
            <span class="sku">${escapeHtml(line.sku)}</span>
          </td>
          <td class="num">${money(line.unitPrice)}</td>
          <td class="num">${line.quantity} <span class="unit">${escapeHtml(line.unitLabel)}</span></td>
          <td class="num">${line.discount > 0 ? `<span class="discount">-${money(line.discount)}</span>` : "&mdash;"}</td>
          <td class="num strong">${money(line.total)}</td>
        </tr>`,
    )
    .join("");

  const notesHtml = view.notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${escapeHtml(view.invoiceNumber)} &middot; ${escapeHtml(view.issuer.name)}</title>
<style>
  :root { --ink:#14182b; --muted:#5b6480; --line:#e2e6f0; --bg:#f5f7fb; --accent:#ff8f1f; }
  *,*::before,*::after { box-sizing:border-box; }
  body {
    margin:0; padding:32px 20px 64px; background:var(--bg); color:var(--ink);
    font:16px/1.55 "Inter",-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  .sheet {
    max-width:820px; margin:0 auto; background:#fff; border-radius:16px;
    padding:40px 44px; box-shadow:0 18px 48px rgba(20,24,43,.10);
  }
  header { display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; margin-bottom:32px; }
  .issuer h1 { margin:0 0 4px; font-size:24px; letter-spacing:-.02em; }
  .issuer p { margin:0; color:var(--muted); font-size:14px; white-space:pre-line; }
  .meta { text-align:right; }
  .meta h2 { margin:0 0 2px; font-size:13px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  .meta .number { font-size:22px; font-weight:700; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
  .badge {
    display:inline-block; margin-top:10px; padding:5px 12px; border-radius:999px;
    font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
    background:${badge.background}; color:${badge.color};
  }
  .parties { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:32px; }
  .party { background:var(--bg); border-radius:12px; padding:16px 18px; }
  .party h3 { margin:0 0 8px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  .party p { margin:0; font-size:14px; white-space:pre-line; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  thead th {
    text-align:left; padding:10px 8px; border-bottom:2px solid var(--line);
    font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); font-weight:600;
  }
  thead th.num, td.num { text-align:right; }
  tbody td { padding:14px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.desc strong { display:block; font-weight:600; }
  td .sku { display:block; margin-top:2px; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  td .unit { color:var(--muted); font-size:12px; }
  td .discount { color:#0f6b45; }
  td.strong { font-weight:600; font-variant-numeric:tabular-nums; }
  .totals { margin-top:24px; margin-left:auto; width:min(320px,100%); }
  .totals div { display:flex; justify-content:space-between; padding:7px 0; font-size:14px; }
  .totals .grand {
    margin-top:8px; padding-top:14px; border-top:2px solid var(--line);
    font-size:19px; font-weight:700; font-variant-numeric:tabular-nums;
  }
  .totals .discount { color:#0f6b45; }
  .notes { margin-top:32px; padding-top:20px; border-top:1px solid var(--line); }
  .notes h3 { margin:0 0 8px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); font-weight:600; }
  .notes ul { margin:0; padding-left:18px; color:var(--muted); font-size:13px; }
  .notes li { margin-bottom:4px; }
  footer { margin-top:36px; text-align:center; color:var(--muted); font-size:12px; }
  .actions { max-width:820px; margin:0 auto 16px; display:flex; justify-content:flex-end; gap:10px; }
  .actions button {
    font:inherit; font-weight:600; cursor:pointer; border:0; border-radius:10px;
    padding:10px 18px; background:var(--ink); color:#fff;
  }
  .actions button.secondary { background:#fff; color:var(--ink); border:1px solid var(--line); }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { box-shadow:none; padding:0; border-radius:0; max-width:none; }
    .actions { display:none; }
  }
  @media (max-width:620px) {
    .sheet { padding:26px 20px; }
    .parties { grid-template-columns:1fr; }
    .meta { text-align:left; }
  }
</style>
</head>
<body>
<div class="actions">
  <button class="secondary" type="button" onclick="history.back()">Back</button>
  <button type="button" onclick="window.print()">Print or save PDF</button>
</div>

<main class="sheet">
  <header>
    <div class="issuer">
      <h1>${escapeHtml(view.issuer.name)}</h1>
      <p>${escapeHtml(view.issuer.address)}
${escapeHtml(view.issuer.email)}
${escapeHtml(view.issuer.phone)}</p>
    </div>
    <div class="meta">
      <h2>Invoice</h2>
      <p class="number">${escapeHtml(view.invoiceNumber)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:var(--muted)">Issued ${escapeHtml(issuedOn)}</p>
      <span class="badge">${escapeHtml(badge.label)}</span>
    </div>
  </header>

  <section class="parties">
    <div class="party">
      <h3>Billed to</h3>
      <p>${escapeHtml(view.customer.name)}
${escapeHtml(view.customer.address)}
${escapeHtml(view.customer.email)}
${escapeHtml(view.customer.phone)}</p>
    </div>
    <div class="party">
      <h3>Order</h3>
      <p>${escapeHtml(view.order.number)}
Placed ${escapeHtml(view.order.placedAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }))}
Status: ${escapeHtml(STATUS_LABEL[view.order.status])}</p>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="num">Unit price</th>
        <th class="num">Quantity</th>
        <th class="num">Discount</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <section class="totals">
    <div><span>Subtotal</span><span>${money(view.subtotal)}</span></div>
    <div class="discount"><span>Discount</span><span>&minus;${money(view.discountTotal)}</span></div>
    <div class="grand"><span>Total due</span><span>${money(view.total)}</span></div>
  </section>

  <section class="notes">
    <h3>Notes</h3>
    <ul>${notesHtml}</ul>
  </section>

  <footer>
    ${escapeHtml(view.issuer.name)} &middot; ${escapeHtml(view.invoiceNumber)} &middot; Thank you for your business.
  </footer>
</main>
</body>
</html>`;
}