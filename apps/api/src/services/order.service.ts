import {
  ORDER_STATUS_TRANSITIONS,
  STOCK_CONSUMING_STATUSES,
  canTransitionOrder,
  paginate,
  type OrderStatus,
} from "@cibus/shared";
import { env } from "../config/env.js";
import {
  IllegalStatusTransitionError,
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { transaction, type Tx } from "../db/pool.js";
import { deleteCartItems, findCartByCustomerId, listCartItemRows } from "../db/repositories/cart.repo.js";
import { findProductsByIds, insertStockMovement } from "../db/repositories/catalog.repo.js";
import {
  attachOrderStockMovements,
  countOrders,
  findIdempotencyKey,
  findInvoicesForOrder,
  findOrderById as findOrderRow,
  findOrderForStatusChange,
  insertIdempotencyKey,
  insertInvoice,
  insertOrder,
  insertOrderItems,
  insertOrderStatusHistory,
  listOrderItems,
  listOrderRows,
  listOrderStatusHistory,
  markIdempotencyCompleted,
  releaseIdempotencyKey as releaseIdempotencyKeyRow,
  updateOrderStatus,
  voidInvoicesForOrder,
} from "../db/repositories/orders.repo.js";
import { claimStock, decrementStock, readStockQuantity } from "../db/repositories/stock.repo.js";
import { recordRedemptions, releaseRedemptions } from "./offer.service.js";
import { priceRequestedLines } from "./pricing.service.js";
import { applyStockMovement, nextInvoiceNumber, nextOrderNumber } from "./stock.service.js";

/**
 * Order service.
 *
 * The checkout path here is the most safety-critical code in the system. Every
 * value it stores is recomputed from the catalogue inside a single transaction;
 * the request contributes only identities, quantities and contact details.
 *
 * Payment and tax are deliberately out of scope: there is no gateway call and no
 * tax column. What is left is the structural half, which must be correct before
 * either can be added.
 */

/**
 * Stock is claimed at order placement, not at cart-add time, and the transition
 * table treats PENDING as already consuming. Cancelling therefore restores it,
 * and a confirmation is not a second decrement.
 */
const STOCK_HELD_STATUSES: readonly OrderStatus[] = ["PENDING", ...STOCK_CONSUMING_STATUSES];

export interface CheckoutCommand {
  customerId?: number;
  email: string;
  fullName: string;
  phone: string;
  fulfilmentMethod: "DELIVERY" | "PICKUP";
  address: {
    fullName: string;
    phone: string;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    postalCode: string;
    landmark?: string | null;
  };
  deliveryNotes?: string | null;
  offerCode?: string | null;
  idempotencyKey: string;
}

export interface CheckoutResult {
  orderId: number;
  orderNumber: string;
  invoiceNumber: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  stockCommitted: boolean;
  paymentRequired: false;
  notice: string;
  items: Array<{ name: string; quantity: number; lineTotal: number }>;
}

const PAYMENT_NOTICE =
  "Order received. Online payment is not yet available, so our team will contact you to confirm and arrange payment.";

/* =============================== checkout ================================ */

export async function placeOrder(command: CheckoutCommand): Promise<CheckoutResult> {
  /* --- idempotency --------------------------------------------------------
   * A retried request must never create a second order. The key is claimed
   * before any work begins, so a duplicate arriving mid-flight waits for the
   * winner rather than racing it.
   */
  const replay = await replayIfAlreadyPlaced(command.idempotencyKey);
  if (replay) return replay;

  const claim = await claimIdempotencyKey(command.idempotencyKey);
  if (!claim) {
    // Another request claimed the key between our read and our insert. It may
    // not have finished yet, so poll briefly before giving up.
    const settled = await awaitExistingOrder(command.idempotencyKey);
    if (settled) return settled;
    await releaseIdempotencyKey(command.idempotencyKey);
  }

  const cart = await loadCustomerCart(command.customerId);
  if (!cart) {
    await releaseIdempotencyKey(command.idempotencyKey);
    throw new ValidationError("Your cart is empty");
  }

  try {
    return await runCheckoutTransaction(command, cart);
  } catch (error) {
    // Free the key so a customer who hits a fixable problem can retry. A failed
    // checkout must never lock them out of trying again.
    await releaseIdempotencyKey(command.idempotencyKey).catch(() => undefined);
    throw error;
  }
}

async function replayIfAlreadyPlaced(key: string): Promise<CheckoutResult | null> {
  const record = await findIdempotencyKey(key);
  if (!record?.orderId) return null;

  const order = await findOrderRow(record.orderId, undefined);
  if (!order) return null;

  const items = await listOrderItems(order.id);
  const invoices = await findInvoicesForOrder(order.id, 1);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    invoiceNumber: invoices[0]?.invoiceNumber ?? "",
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    total: order.total,
    stockCommitted: true,
    paymentRequired: false,
    notice: "This order was already placed. No duplicate was created.",
    items: items.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
  };
}

async function awaitExistingOrder(key: string): Promise<CheckoutResult | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const result = await replayIfAlreadyPlaced(key);
    if (result) return result;
  }
  return null;
}

async function claimIdempotencyKey(key: string): Promise<boolean> {
  try {
    await insertIdempotencyKey(key, "checkout");
    return true;
  } catch {
    return false;
  }
}

async function releaseIdempotencyKey(key: string): Promise<void> {
  await releaseIdempotencyKeyRow(key);
}

async function loadCustomerCart(customerId?: number) {
  if (!customerId) return null;
  const cart = await findCartByCustomerId(customerId);
  if (!cart) return null;
  return { id: cart.id, items: await listCartItemRows(cart.id) };
}

async function runCheckoutTransaction(
  command: CheckoutCommand,
  cart: { id: number; items: Array<{ productId: number; quantity: number }> },
): Promise<CheckoutResult> {
  return transaction(async (tx) => {
    const now = new Date();

    /* --- 1. re-read the catalogue inside the transaction ---------------- */
    const productIds = cart.items.map((item) => item.productId);
    const products = await findProductsByIds(productIds, tx);
    const byId = new Map(products.map((product) => [product.id, product]));

    const gone = products
      .filter((product) => product.deletedAt !== null || !product.isActive)
      .map((product) => product.name);
    const missing = productIds.filter((id) => !byId.has(id));

    if (gone.length > 0 || missing.length > 0) {
      throw new ValidationError("Some items are no longer available. Review your cart and try again.", {
        unavailable: gone,
        missing,
      });
    }

    /* --- 2. price through the shared pricing service -------------------- */
    const pricing = await priceRequestedLines(
      cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      { offerCode: command.offerCode ?? null, now, tx },
    );

    const extended = pricing as typeof pricing & {
      unavailableProductIds?: number[];
      invalidOfferCode?: string;
    };
    if (extended.invalidOfferCode) {
      throw new ValidationError(`Offer code "${extended.invalidOfferCode}" is not recognised`, {
        offerCode: extended.invalidOfferCode,
      });
    }
    if (extended.unavailableProductIds?.length) {
      throw new ValidationError("Some items are no longer available. Review your cart and try again.");
    }

    /* --- 3. claim stock atomically ---------------------------------------
     * A conditional UPDATE per line takes the stock. Two customers checking
     * out the last unit both read quantity 1, but only one UPDATE satisfies
     * `stock_quantity >= requested`, so only one proceeds and the loser's
     * whole transaction rolls back.
     */
    for (const item of cart.items) {
      const product = byId.get(item.productId)!;

      if (product.allowBackorder) {
        await decrementStock(product.id, item.quantity, tx);
        const balanceAfter = (await readStockQuantity(product.id, tx)) ?? 0;
        await insertStockMovement(
          {
            productId: product.id,
            type: "SALE",
            quantityChange: -item.quantity,
            balanceAfter,
            referenceType: "ORDER",
            note: "Backorder sale",
            createdById: null,
          },
          tx,
        );
        continue;
      }

      const claimed = await claimStock(product.id, item.quantity, tx);
      if (claimed === 0) {
        throw new InsufficientStockError(
          product.stockQuantity > 0
            ? `"${product.name}" sold out while you were checking out. Only ${product.stockQuantity} remained.`
            : `"${product.name}" is out of stock.`,
          [
            {
              productId: product.id,
              name: product.name,
              requested: item.quantity,
              available: product.stockQuantity,
            },
          ],
        );
      }

      const balanceAfter = (await readStockQuantity(product.id, tx)) ?? 0;
      await insertStockMovement(
        {
          productId: product.id,
          type: "SALE",
          quantityChange: -item.quantity,
          balanceAfter,
          referenceType: "ORDER",
          note: "",
          createdById: null,
        },
        tx,
      );
    }

    /* --- 4. write the order and its snapshot lines ---------------------- */
    const orderNumber = await nextOrderNumber(tx, now);
    const { id: orderId } = await insertOrder(
      {
        orderNumber,
        customerId: command.customerId ?? null,
        status: "PENDING",
        fulfilmentMethod: command.fulfilmentMethod,
        customerName: command.fullName,
        customerEmail: command.email,
        customerPhone: command.phone,
        addressLine1: command.address.line1,
        addressLine2: command.address.line2 ?? null,
        addressCity: command.address.city,
        addressState: command.address.state,
        addressPostalCode: command.address.postalCode,
        addressLandmark: command.address.landmark ?? null,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        total: pricing.total,
        deliveryNotes: command.deliveryNotes ?? "",
      },
      tx,
    );

    await insertOrderItems(
      orderId,
      pricing.lines.map((line) => ({
        productId: line.productId,
        productName: line.name,
        productSlug: line.slug,
        sku: line.sku,
        unitLabel: line.unitLabel,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineDiscount: line.lineDiscount,
        lineTotal: line.lineTotal,
        offerId: line.offerId,
        offerName: line.offerName,
      })),
      tx,
    );

    await insertOrderStatusHistory(
      {
        orderId,
        fromStatus: null,
        toStatus: "PENDING",
        note: "Order placed",
        changedBy: command.customerId ? `customer:${command.customerId}` : "guest",
      },
      tx,
    );

    /* --- 5. tie the SALE movements to the order ------------------------- */
    await attachOrderStockMovements(productIds, orderId, tx);

    /* --- 6. record offer redemptions ------------------------------------ */
    await recordRedemptions(
      tx,
      orderId,
      pricing.appliedOffers.map((offer) => ({ offerId: offer.offerId, discount: offer.discount })),
    );

    /* --- 7. issue the invoice ------------------------------------------- */
    const { invoiceNumber, financialYear } = await nextInvoiceNumber(tx, now);
    await insertInvoice(
      {
        invoiceNumber,
        financialYear,
        orderId,
        issuerName: env.COMPANY_NAME,
        issuerAddress: env.COMPANY_ADDRESS,
        issuerEmail: env.COMPANY_EMAIL,
        issuerPhone: env.COMPANY_PHONE,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        total: pricing.total,
      },
      tx,
    );

    /* --- 8. empty the cart and close out the idempotency record ---------- */
    await deleteCartItems(cart.id, tx);
    await markIdempotencyCompleted(command.idempotencyKey, orderId, orderNumber, tx);

    return {
      orderId,
      orderNumber,
      invoiceNumber,
      subtotal: pricing.subtotal,
      discountTotal: pricing.discountTotal,
      total: pricing.total,
      stockCommitted: true,
      paymentRequired: false,
      notice: PAYMENT_NOTICE,
      items: pricing.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      })),
    };
  });
}

/* ================================= reads ================================= */

export interface OrderListView {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  fulfilmentMethod: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressCity: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  createdAt: Date;
  itemCount: number;
}

export interface OrderDetailView {
  id: number;
  orderNumber: string;
  customerId: number | null;
  status: OrderStatus;
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
  createdAt: Date;
  confirmedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  items: Array<{
    id: number;
    productId: number | null;
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
  }>;
  invoices: Array<{ id: number; invoiceNumber: string; status: string; total: number; issuedAt: Date }>;
  statusHistory: Array<{
    id: number;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    note: string;
    changedBy: string;
    createdAt: Date;
  }>;
  customer: { id: number; email: string; fullName: string } | null;
}

export async function listOrders(query: {
  page: number;
  pageSize: number;
  customerId?: number;
  status?: OrderStatus;
  search?: string;
  from?: Date;
  to?: Date;
}): Promise<{ items: OrderListView[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.customerId !== undefined) {
    where.push("o.customer_id = ?");
    params.push(query.customerId);
  }
  if (query.status) {
    where.push("o.status = ?");
    params.push(query.status);
  }
  if (query.from) {
    where.push("o.created_at >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("o.created_at <= ?");
    params.push(query.to);
  }
  if (query.search) {
    // Escape LIKE wildcards so searching "100%" does not match everything.
    const term = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push(
      "(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.customer_phone LIKE ?)",
    );
    params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countOrders(whereSql, params),
    listOrderRows(whereSql, params, query.pageSize, offset),
  ]);

  return paginate(
    rows.map((row) => ({
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      fulfilmentMethod: row.fulfilmentMethod,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      addressCity: row.addressCity,
      subtotal: row.subtotal,
      discountTotal: row.discountTotal,
      total: row.total,
      createdAt: row.createdAt,
      itemCount: Number(row.itemCount),
    })),
    total,
    query.page,
    query.pageSize,
  );
}

export async function getOrderById(
  id: number,
  options: { customerId?: number } = {},
): Promise<OrderDetailView> {
  const order = await findOrderRow(id, options.customerId);
  if (!order) throw new NotFoundError("Order");

  const [items, invoices, statusHistory] = await Promise.all([
    listOrderItems(order.id),
    findInvoicesForOrder(order.id),
    listOrderStatusHistory(order.id),
  ]);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    status: order.status,
    fulfilmentMethod: order.fulfilmentMethod,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    addressCity: order.addressCity,
    addressState: order.addressState,
    addressPostalCode: order.addressPostalCode,
    addressLandmark: order.addressLandmark,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    total: order.total,
    deliveryNotes: order.deliveryNotes,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      sku: item.sku,
      unitLabel: item.unitLabel,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineDiscount: item.lineDiscount,
      lineTotal: item.lineTotal,
      offerId: item.offerId,
      offerName: item.offerName,
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      total: invoice.total,
      issuedAt: invoice.issuedAt,
    })),
    statusHistory: statusHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus as OrderStatus | null,
      toStatus: entry.toStatus as OrderStatus,
      note: entry.note,
      changedBy: entry.changedBy,
      createdAt: entry.createdAt,
    })),
    customer: null,
  };
}

/* =========================== status transitions =========================== */

export interface StatusChangeResult {
  orderId: number;
  orderNumber: string;
  from: OrderStatus;
  to: OrderStatus;
  stockRestored: boolean;
  allowedNext: readonly OrderStatus[];
}

export async function changeOrderStatus(
  orderId: number,
  to: OrderStatus,
  options: { note?: string; changedBy: string },
): Promise<StatusChangeResult> {
  return transaction(async (tx) => {
    const order = await findOrderForStatusChange(orderId, tx);
    if (!order) throw new NotFoundError("Order");

    const from = order.status;

    if (from === to) {
      throw new IllegalStatusTransitionError(from, to);
    }
    if (!canTransitionOrder(from, to)) {
      const allowed = ORDER_STATUS_TRANSITIONS[from];
      throw new IllegalStatusTransitionError(
        `${from} (permitted next: ${allowed.length > 0 ? allowed.join(", ") : "none"})`,
        to,
      );
    }

    // Releasing stock is driven by the transition itself, so the ledger and
    // the cached quantity can never disagree with the order status.
    const heldBefore = STOCK_HELD_STATUSES.includes(from);
    const heldAfter = STOCK_HELD_STATUSES.includes(to);
    let stockRestored = false;

    if (heldBefore && !heldAfter) {
      const items = await listOrderItems(order.id);
      for (const item of items) {
        if (item.productId === null) continue;
        await applyStockMovement(tx, {
          productId: item.productId,
          quantityChange: item.quantity,
          type: "RETURN",
          referenceType: "ORDER",
          referenceId: String(order.id),
          note: `Order ${order.orderNumber} ${to.toLowerCase()}`,
        });
      }
      stockRestored = true;
      await releaseRedemptions(tx, order.id);
      await voidInvoicesForOrder(orderId, tx);
    }

    await updateOrderStatus(
      orderId,
      {
        status: to,
        confirmedAt: to === "CONFIRMED",
        deliveredAt: to === "DELIVERED",
        cancelledAt: to === "CANCELLED" || to === "REFUNDED",
      },
      tx,
    );

    await insertOrderStatusHistory(
      {
        orderId,
        fromStatus: from,
        toStatus: to,
        note: options.note ?? "",
        changedBy: options.changedBy,
      },
      tx,
    );

    return {
      orderId,
      orderNumber: order.orderNumber,
      from,
      to,
      stockRestored,
      allowedNext: ORDER_STATUS_TRANSITIONS[to],
    };
  });
}

export { ORDER_STATUS_TRANSITIONS };