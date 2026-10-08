import { paginate } from "@cibus/shared";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { env } from "../config/env.js";
import type { InvoiceStatus, OrderStatus } from "../db/enums.js";
import {
  countInvoiceRows,
  findInvoiceById as findInvoiceRow,
  findInvoiceRowByOrderId,
  findInvoiceStatusContext,
  findOrderById as findOrderRow,
  listInvoiceRows,
  listOrderItems,
  updateInvoiceStatus,
} from "../db/repositories/orders.repo.js";
import type { InvoiceRow, OrderItemRow, OrderRow } from "../db/types.js";

/**
 * Invoice service.
 *
 * An invoice is a snapshot. It is generated from the order's stored line items,
 * which are themselves snapshots from the moment of purchase. Repricing or
 * renaming a product therefore cannot alter an invoice issued three catalogue
 * generations earlier - and because the customer details live on the order row
 * rather than on the customer, a later profile edit cannot rewrite them either.
 *
 * The business verification to perform after any future change here: place an
 * order, change the product's name and price, regenerate the invoice, and assert
 * nothing on it moved.
 */

export interface ListInvoicesQuery {
  page: number;
  pageSize: number;
  customerId?: number;
  status?: InvoiceStatus;
  orderId?: number;
}

export async function listInvoices(query: ListInvoicesQuery) {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.status) {
    clauses.push("inv.status = ?");
    params.push(query.status);
  }
  if (query.orderId) {
    clauses.push("inv.order_id = ?");
    params.push(query.orderId);
  }
  if (query.customerId !== undefined) {
    clauses.push("o.customer_id = ?");
    params.push(query.customerId);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const offset = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countInvoiceRows(whereSql, params),
    listInvoiceRows(whereSql, params, query.pageSize, offset),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    financialYear: row.financialYear,
    orderId: row.orderId,
    status: row.status,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    total: row.total,
    issuedAt: row.issuedAt,
    dueAt: row.dueAt,
    order: {
      id: row.orderId,
      orderNumber: row.orderNumber,
      customerName: row.orderCustomerName,
      customerEmail: row.orderCustomerEmail,
      status: row.orderStatus,
      createdAt: row.orderCreatedAt,
    },
  }));

  return paginate(items, total, query.page, query.pageSize);
}

interface InvoiceWithOrder {
  invoice: InvoiceRow;
  order: OrderRow;
  items: OrderItemRow[];
}

function asView({ invoice, order, items }: InvoiceWithOrder) {
  return { ...invoice, order: { ...order, items } };
}

async function loadInvoiceWithOrder(
  invoice: InvoiceRow | null,
  options: { customerId?: number },
): Promise<ReturnType<typeof asView> | null> {
  if (!invoice) return null;
  const order = await findOrderRow(invoice.orderId, options.customerId);
  // A customer may only ever read their own invoice; a missing (or mismatched)
  // order is reported as "not found" so an id cannot be probed.
  if (!order) return null;
  const items = await listOrderItems(order.id);
  return asView({ invoice, order, items });
}

export async function getInvoiceById(id: number, options: { customerId?: number } = {}) {
  const invoice = await findInvoiceRow(id);
  const view = await loadInvoiceWithOrder(invoice, options);
  if (!view) throw new NotFoundError("Invoice");
  return view;
}

export async function getInvoiceByOrderId(orderId: number, options: { customerId?: number } = {}) {
  const invoice = await findInvoiceRowByOrderId(orderId);
  const view = await loadInvoiceWithOrder(invoice, options);
  if (!view) throw new NotFoundError("Invoice");
  return view;
}

export async function setInvoiceStatus(id: number, status: InvoiceStatus, reason?: string) {
  const invoice = await findInvoiceStatusContext(id);
  if (!invoice) throw new NotFoundError("Invoice");

  if (invoice.status === "VOID") {
    throw new ValidationError("A voided invoice cannot be changed");
  }

  if (status === "PAID" && invoice.orderStatus === "PENDING") {
    // Marking an invoice paid normally follows a payment event. Since no gateway
    // is integrated yet, this must be an explicit, deliberate action.
    throw new ValidationError(
      "Marking an invoice paid also requires the order to be confirmed or later. Confirm the order first.",
    );
  }

  await updateInvoiceStatus(id, status, reason);
  const updated = await findInvoiceRow(id);
  if (!updated) throw new NotFoundError("Invoice");
  return updated;
}

export interface InvoiceView {
  invoiceNumber: string;
  issuedAt: Date;
  status: InvoiceStatus;
  issuer: { name: string; address: string; email: string; phone: string };
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
  };
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
}

/**
 * Assemble the printable view of an invoice from stored snapshots.
 *
 * Deliberately derived from the invoice and its order rows only, so the output
 * cannot change if a product, offer or company setting is edited later.
 */
export function buildInvoiceView(invoice: {
  invoiceNumber: string;
  issuedAt: Date;
  status: InvoiceStatus;
  issuerName: string;
  issuerAddress: string;
  issuerEmail: string;
  issuerPhone: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  order: {
    orderNumber: string;
    status: OrderStatus;
    createdAt: Date;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    addressLine1: string;
    addressLine2: string | null;
    addressCity: string;
    addressState: string;
    addressPostalCode: string;
    addressLandmark: string | null;
    deliveryNotes: string;
    items: Array<{
      productName: string;
      sku: string;
      unitLabel: string;
      unitPrice: number;
      quantity: number;
      lineDiscount: number;
      lineTotal: number;
      offerName: string | null;
    }>;
  };
}): InvoiceView {
  const { order } = invoice;

  const addressParts = [
    order.addressLine1,
    order.addressLine2,
    order.addressLandmark ? `Landmark: ${order.addressLandmark}` : null,
    [order.addressCity, order.addressState, order.addressPostalCode].filter(Boolean).join(", "),
  ].filter((part): part is string => Boolean(part));

  return {
    invoiceNumber: invoice.invoiceNumber,
    issuedAt: invoice.issuedAt,
    status: invoice.status,
    issuer: {
      name: invoice.issuerName,
      address: invoice.issuerAddress,
      email: invoice.issuerEmail,
      phone: invoice.issuerPhone,
    },
    customer: {
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
      address: addressParts.join("\n"),
    },
    order: { number: order.orderNumber, status: order.status, placedAt: order.createdAt },
    lines: order.items.map((item) => ({
      description: item.productName,
      sku: item.sku,
      unitLabel: item.unitLabel,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discount: item.lineDiscount,
      total: item.lineTotal,
    })),
    subtotal: invoice.subtotal,
    discountTotal: invoice.discountTotal,
    total: invoice.total,
    notes: [
      ...(invoice.discountTotal > 0 ? ["Discounts shown per line are already deducted."] : []),
      "Payment is arranged directly with our team. No online payment has been processed.",
      ...(order.deliveryNotes ? [`Delivery notes: ${order.deliveryNotes}`] : []),
    ],
  };
}

/** CSV export for the admin panel. Amounts are in major units for readability. */
export function ordersToCsv(
  orders: Array<{
    orderNumber: string;
    createdAt: Date;
    status: OrderStatus;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    addressCity: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    itemCount: number;
  }>,
): string {
  const header = [
    "Order",
    "Date",
    "Status",
    "Customer",
    "Email",
    "Phone",
    "City",
    "Items",
    "Subtotal",
    "Discount",
    "Total",
    "Currency",
  ];

  const rows = orders.map((order) => [
    order.orderNumber,
    order.createdAt.toISOString(),
    order.status,
    order.customerName,
    order.customerEmail,
    order.customerPhone,
    order.addressCity,
    String(order.itemCount),
    (order.subtotal / 100).toFixed(2),
    (order.discountTotal / 100).toFixed(2),
    (order.total / 100).toFixed(2),
    env.CURRENCY,
  ]);

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  // Guard against spreadsheet formula injection from user-supplied names.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}