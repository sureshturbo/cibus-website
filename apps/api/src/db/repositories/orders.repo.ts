import { db, type Tx } from "../pool.js";
import type { IdempotencyKeyRow, InvoiceRow, OrderItemRow, OrderRow } from "../types.js";

/**
 * Order, order-line, status-history, invoice-write and idempotency data access.
 *
 * Historical order lines snapshot the product name, slug, SKU, unit price and
 * label at purchase time. That is deliberate: invoices stay correct after the
 * catalogue is edited, so these columns are read as stored and never joined back
 * to `products`.
 */

export const ORDER_COLUMNS = `
  o.id, o.order_number AS orderNumber, o.customer_id AS customerId, o.status,
  o.fulfilment_method AS fulfilmentMethod, o.customer_name AS customerName,
  o.customer_email AS customerEmail, o.customer_phone AS customerPhone,
  o.address_line1 AS addressLine1, o.address_line2 AS addressLine2,
  o.address_city AS addressCity, o.address_state AS addressState,
  o.address_postal_code AS addressPostalCode, o.address_landmark AS addressLandmark,
  o.subtotal, o.discount_total AS discountTotal, o.total, o.delivery_notes AS deliveryNotes,
  o.stock_committed_at AS stockCommittedAt, o.confirmed_at AS confirmedAt,
  o.delivered_at AS deliveredAt, o.cancelled_at AS cancelledAt, o.cancel_reason AS cancelReason,
  o.created_at AS createdAt, o.updated_at AS updatedAt
`;

export const ORDER_ITEM_COLUMNS = `
  i.id, i.order_id AS orderId, i.product_id AS productId, i.product_name AS productName,
  i.product_slug AS productSlug, i.sku, i.unit_label AS unitLabel, i.unit_price AS unitPrice,
  i.quantity, i.line_discount AS lineDiscount, i.line_total AS lineTotal,
  i.offer_id AS offerId, i.offer_name AS offerName
`;

export const INVOICE_COLUMNS = `
  inv.id, inv.invoice_number AS invoiceNumber, inv.financial_year AS financialYear,
  inv.order_id AS orderId, inv.status,
  inv.issuer_name AS issuerName, inv.issuer_address AS issuerAddress,
  inv.issuer_email AS issuerEmail, inv.issuer_phone AS issuerPhone,
  inv.subtotal, inv.discount_total AS discountTotal, inv.total,
  inv.issued_at AS issuedAt, inv.due_at AS dueAt, inv.pdf_path AS pdfPath,
  inv.voided_at AS voidedAt, inv.void_reason AS voidReason,
  inv.created_at AS createdAt, inv.updated_at AS updatedAt
`;

/* ------------------------------ idempotency ------------------------------ */

export function findIdempotencyKey(key: string, conn: Tx = db): Promise<IdempotencyKeyRow | null> {
  return conn.queryOne<IdempotencyKeyRow>(
    `SELECT id, \`key\`, scope, order_id AS orderId, response_hash AS responseHash, status,
            created_at AS createdAt, updated_at AS updatedAt
       FROM idempotency_keys WHERE \`key\` = ? LIMIT 1`,
    [key],
  );
}

export async function insertIdempotencyKey(key: string, scope: string, conn: Tx = db): Promise<void> {
  await conn.execute(
    "INSERT INTO idempotency_keys (`key`, scope, status) VALUES (?, ?, 'IN_PROGRESS')",
    [key, scope],
  );
}

export async function markIdempotencyCompleted(
  key: string,
  orderId: number,
  responseHash: string,
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    "UPDATE idempotency_keys SET order_id = ?, response_hash = ?, status = 'COMPLETED', updated_at = NOW() WHERE `key` = ?",
    [orderId, responseHash, key],
  );
}

export async function releaseIdempotencyKey(key: string, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM idempotency_keys WHERE `key` = ? AND order_id IS NULL", [key]);
}

/* -------------------------------- writes --------------------------------- */

export interface InsertOrderValues {
  orderNumber: string;
  customerId: number | null;
  status: string;
  fulfilmentMethod: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressLandmark: string | null;
  subtotal: number;
  discountTotal: number;
  total: number;
  deliveryNotes: string;
}

export async function insertOrder(values: InsertOrderValues, conn: Tx = db): Promise<{ id: number }> {
  const result = await conn.execute(
    `INSERT INTO orders
       (order_number, customer_id, status, fulfilment_method, customer_name, customer_email,
        customer_phone, address_line1, address_line2, address_city, address_state,
        address_postal_code, address_landmark, subtotal, discount_total, total, delivery_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.orderNumber,
      values.customerId,
      values.status,
      values.fulfilmentMethod,
      values.customerName,
      values.customerEmail,
      values.customerPhone,
      values.addressLine1,
      values.addressLine2,
      values.addressCity,
      values.addressState,
      values.addressPostalCode,
      values.addressLandmark,
      values.subtotal,
      values.discountTotal,
      values.total,
      values.deliveryNotes,
    ],
  );
  return { id: result.insertId };
}

export interface InsertOrderItemValues {
  productId: number;
  productName: string;
  productSlug: string;
  sku: string;
  unitLabel: string;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  lineTotal: number;
  offerId: number | null;
  offerName: string | null;
}

export async function insertOrderItems(
  orderId: number,
  lines: InsertOrderItemValues[],
  conn: Tx = db,
): Promise<void> {
  if (lines.length === 0) return;
  const placeholders = lines.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const params = lines.flatMap((line) => [
    orderId,
    line.productId,
    line.productName,
    line.productSlug,
    line.sku,
    line.unitLabel,
    line.unitPrice,
    line.quantity,
    line.lineDiscount,
    line.lineTotal,
    line.offerId,
    line.offerName,
  ]);
  await conn.execute(
    `INSERT INTO order_items
       (order_id, product_id, product_name, product_slug, sku, unit_label, unit_price,
        quantity, line_discount, line_total, offer_id, offer_name)
     VALUES ${placeholders}`,
    params,
  );
}

export async function insertOrderStatusHistory(
  values: { orderId: number; fromStatus: string | null; toStatus: string; note: string; changedBy: string },
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    `INSERT INTO order_status_history (order_id, from_status, to_status, note, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [values.orderId, values.fromStatus, values.toStatus, values.note, values.changedBy],
  );
}

/** Tie the SALE movements written during checkout to the order that created them. */
export async function attachOrderStockMovements(
  productIds: number[],
  orderId: number,
  conn: Tx = db,
): Promise<void> {
  if (productIds.length === 0) return;
  await conn.execute(
    `UPDATE stock_movements SET reference_id = ?
      WHERE product_id IN (${productIds.map(() => "?").join(",")})
        AND type = 'SALE' AND reference_type = 'ORDER' AND reference_id IS NULL`,
    [String(orderId), ...productIds],
  );
}

export interface InsertInvoiceValues {
  invoiceNumber: string;
  financialYear: string;
  orderId: number;
  issuerName: string;
  issuerAddress: string;
  issuerEmail: string;
  issuerPhone: string;
  subtotal: number;
  discountTotal: number;
  total: number;
}

export async function insertInvoice(values: InsertInvoiceValues, conn: Tx = db): Promise<{ id: number }> {
  const result = await conn.execute(
    `INSERT INTO invoices
       (invoice_number, financial_year, order_id, status, issuer_name, issuer_address,
        issuer_email, issuer_phone, subtotal, discount_total, total)
     VALUES (?, ?, ?, 'ISSUED', ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.invoiceNumber,
      values.financialYear,
      values.orderId,
      values.issuerName,
      values.issuerAddress,
      values.issuerEmail,
      values.issuerPhone,
      values.subtotal,
      values.discountTotal,
      values.total,
    ],
  );
  return { id: result.insertId };
}

/* -------------------------------- reads ---------------------------------- */

export async function findOrderById(
  id: number,
  customerId: number | undefined,
  conn: Tx = db,
): Promise<OrderRow | null> {
  const clause = customerId === undefined ? "" : "AND o.customer_id = ?";
  const params = customerId === undefined ? [id] : [id, customerId];
  return conn.queryOne<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = ? ${clause}`, params);
}

export function listOrderItems(orderId: number, conn: Tx = db): Promise<OrderItemRow[]> {
  return conn.query<OrderItemRow>(
    `SELECT ${ORDER_ITEM_COLUMNS} FROM order_items i WHERE i.order_id = ? ORDER BY i.id ASC`,
    [orderId],
  );
}

export function findInvoicesForOrder(orderId: number, take?: number, conn: Tx = db): Promise<InvoiceRow[]> {
  const limit = take ? "LIMIT ?" : "";
  const params = take ? [orderId, take] : [orderId];
  return conn.query<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM invoices inv WHERE inv.order_id = ? ORDER BY inv.id ASC ${limit}`,
    params,
  );
}

export interface StatusHistoryRow {
  id: number;
  orderId: number;
  fromStatus: string | null;
  toStatus: string;
  note: string;
  changedBy: string;
  createdAt: Date;
}

export function listOrderStatusHistory(orderId: number, conn: Tx = db): Promise<StatusHistoryRow[]> {
  return conn.query<StatusHistoryRow>(
    `SELECT id, order_id AS orderId, from_status AS fromStatus, to_status AS toStatus,
            note, changed_by AS changedBy, created_at AS createdAt
       FROM order_status_history WHERE order_id = ? ORDER BY id ASC`,
    [orderId],
  );
}

export interface OrderListRow extends OrderRow {
  itemCount: number;
}

export async function countOrders(
  whereSql: string,
  params: readonly unknown[],
  conn: Tx = db,
): Promise<number> {
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM orders o ${whereSql}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export function listOrderRows(
  whereSql: string,
  params: readonly unknown[],
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<OrderListRow[]> {
  return conn.query<OrderListRow>(
    `SELECT ${ORDER_COLUMNS},
            (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS itemCount
       FROM orders o ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

/* ------------------------- status transitions ---------------------------- */

export async function findOrderForStatusChange(id: number, conn: Tx = db): Promise<OrderRow | null> {
  return conn.queryOne<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = ? FOR UPDATE`, [id]);
}

export async function updateOrderStatus(
  id: number,
  values: {
    status: string;
    confirmedAt?: boolean;
    deliveredAt?: boolean;
    cancelledAt?: boolean;
  },
  conn: Tx = db,
): Promise<void> {
  const sets = ["status = ?", "updated_at = NOW()"];
  const params: unknown[] = [values.status];
  if (values.confirmedAt) sets.push("confirmed_at = NOW()");
  if (values.deliveredAt) sets.push("delivered_at = NOW()");
  if (values.cancelledAt) sets.push("cancelled_at = NOW()");
  params.push(id);
  await conn.execute(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function voidInvoicesForOrder(orderId: number, conn: Tx = db): Promise<void> {
  await conn.execute(
    "UPDATE invoices SET status = 'VOID', updated_at = NOW() WHERE order_id = ? AND status = 'ISSUED'",
    [orderId],
  );
}

/* ------------------------------- invoices -------------------------------- */

export async function findInvoiceById(id: number, conn: Tx = db): Promise<InvoiceRow | null> {
  return conn.queryOne<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM invoices inv WHERE inv.id = ?`,
    [id],
  );
}

export function findInvoiceRowByOrderId(orderId: number, conn: Tx = db): Promise<InvoiceRow | null> {
  return conn.queryOne<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM invoices inv WHERE inv.order_id = ? ORDER BY inv.id ASC LIMIT 1`,
    [orderId],
  );
}

export interface InvoiceListRow extends InvoiceRow {
  orderNumber: string;
  orderCustomerName: string;
  orderCustomerEmail: string;
  orderStatus: string;
  orderCreatedAt: Date;
}

export async function countInvoiceRows(
  whereSql: string,
  params: readonly unknown[],
  conn: Tx = db,
): Promise<number> {
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM invoices inv JOIN orders o ON o.id = inv.order_id ${whereSql}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export function listInvoiceRows(
  whereSql: string,
  params: readonly unknown[],
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<InvoiceListRow[]> {
  return conn.query<InvoiceListRow>(
    `SELECT ${INVOICE_COLUMNS},
            o.order_number AS orderNumber, o.customer_name AS orderCustomerName,
            o.customer_email AS orderCustomerEmail, o.status AS orderStatus,
            o.created_at AS orderCreatedAt
       FROM invoices inv
       JOIN orders o ON o.id = inv.order_id
       ${whereSql}
       ORDER BY inv.issued_at DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export interface InvoiceStatusContextRow {
  id: number;
  status: string;
  total: number;
  orderStatus: string;
  orderNumber: string;
}

export function findInvoiceStatusContext(
  id: number,
  conn: Tx = db,
): Promise<InvoiceStatusContextRow | null> {
  return conn.queryOne<InvoiceStatusContextRow>(
    `SELECT inv.id, inv.status, inv.total, o.status AS orderStatus, o.order_number AS orderNumber
       FROM invoices inv JOIN orders o ON o.id = inv.order_id WHERE inv.id = ?`,
    [id],
  );
}

export async function updateInvoiceStatus(
  id: number,
  status: string,
  voidReason?: string,
  conn: Tx = db,
): Promise<void> {
  if (status === "VOID") {
    await conn.execute(
      "UPDATE invoices SET status = ?, voided_at = NOW(), void_reason = ?, updated_at = NOW() WHERE id = ?",
      [status, voidReason ?? "Voided by administrator", id],
    );
    return;
  }
  await conn.execute("UPDATE invoices SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
}