import { Prisma } from "@prisma/client";
import {
  ORDER_STATUS_TRANSITIONS,
  STOCK_CONSUMING_STATUSES,
  canTransitionOrder,
  evaluateOffers,
  multiplyMinor,
  paginate,
  type OrderStatus,
  type PricingLine,
} from "@cibus/shared";
import { env } from "../config/env.js";
import {
  IllegalStatusTransitionError,
  InsufficientStockError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { recordRedemptions, releaseRedemptions } from "./offer.service.js";
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

type Tx = Prisma.TransactionClient;

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
  const record = await prisma.idempotencyKey.findUnique({
    where: { key },
    include: {
      order: {
        include: {
          items: { select: { productName: true, quantity: true, lineTotal: true } },
          invoices: { orderBy: { id: "asc" }, take: 1, select: { invoiceNumber: true } },
        },
      },
    },
  });

  if (!record?.order) return null;

  return {
    orderId: record.order.id,
    orderNumber: record.order.orderNumber,
    invoiceNumber: record.order.invoices[0]?.invoiceNumber ?? "",
    subtotal: record.order.subtotal,
    discountTotal: record.order.discountTotal,
    total: record.order.total,
    stockCommitted: true,
    paymentRequired: false,
    notice: "This order was already placed. No duplicate was created.",
    items: record.order.items.map((item) => ({
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
    await prisma.idempotencyKey.create({
      data: { key, scope: "checkout", status: "IN_PROGRESS" },
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseIdempotencyKey(key: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { key, orderId: null } });
}

async function loadCustomerCart(customerId?: number) {
  if (!customerId) return null;
  return prisma.cart.findFirst({
    where: { customerId },
    select: { id: true, items: { select: { productId: true, quantity: true } } },
  });
}

async function runCheckoutTransaction(
  command: CheckoutCommand,
  cart: { id: number; items: Array<{ productId: number; quantity: number }> },
): Promise<CheckoutResult> {
  return prisma.$transaction(
    async (tx) => {
      const now = new Date();

      /* --- 1. re-read the catalogue inside the transaction ---------------- */
      const productIds = cart.items.map((item) => item.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          categoryId: true,
          name: true,
          slug: true,
          sku: true,
          unitLabel: true,
          price: true,
          stockQuantity: true,
          allowBackorder: true,
          isActive: true,
          deletedAt: true,
        },
      });
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

      /* --- 2. load offers through this transaction ------------------------ */
      const pricing = await priceWithinTransaction(tx, cart.items, command.offerCode ?? null, now);

      /* --- 3. claim stock atomically ---------------------------------------
       * A conditional UPDATE per line takes the stock. Two customers checking
       * out the last unit both read quantity 1, but only one UPDATE satisfies
       * `stock_quantity >= requested`, so only one proceeds and the loser's
       * whole transaction rolls back.
       */
      for (const item of cart.items) {
        const product = byId.get(item.productId)!;

        if (product.allowBackorder) {
          const updated = await tx.product.update({
            where: { id: product.id },
            data: { stockQuantity: { decrement: item.quantity } },
            select: { stockQuantity: true },
          });
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: "SALE",
              quantityChange: -item.quantity,
              balanceAfter: updated.stockQuantity,
              referenceType: "ORDER",
              note: "Backorder sale",
            },
          });
          continue;
        }

        const claimed = await tx.product.updateMany({
          where: { id: product.id, stockQuantity: { gte: item.quantity } },
          data: { stockQuantity: { decrement: item.quantity } },
        });

        if (claimed.count === 0) {
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

        const refreshed = await tx.product.findUniqueOrThrow({
          where: { id: product.id },
          select: { stockQuantity: true },
        });

        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "SALE",
            quantityChange: -item.quantity,
            balanceAfter: refreshed.stockQuantity,
            referenceType: "ORDER",
            note: "Order placed",
          },
        });
      }

      /* --- 4. allocate numbers and write the order ------------------------- */
      const orderNumber = await nextOrderNumber(tx, now);

      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: command.customerId ?? null,
          status: "PENDING",
          fulfilmentMethod: command.fulfilmentMethod,
          customerName: command.fullName,
          customerEmail: command.email,
          customerPhone: command.phone,
          addressLine1: command.address.line1,
          addressLine2: command.address.line2 || null,
          addressCity: command.address.city,
          addressState: command.address.state,
          addressPostalCode: command.address.postalCode,
          addressLandmark: command.address.landmark || null,
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
          deliveryNotes: command.deliveryNotes ?? "",
          items: {
            create: pricing.lines.map((line) => ({
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
          },
          statusHistory: {
            create: {
              toStatus: "PENDING",
              changedBy: command.customerId ? `customer:${command.customerId}` : "guest",
              note: "Order placed",
            },
          },
        },
        select: { id: true, orderNumber: true },
      });

      /* --- 5. attach the stock movements to the order ---------------------- */
      await tx.stockMovement.updateMany({
        where: {
          productId: { in: productIds },
          type: "SALE",
          referenceType: "ORDER",
          referenceId: null,
        },
        data: { referenceId: String(order.id) },
      });

      /* --- 6. record offer usage ------------------------------------------ */
      await recordRedemptions(
        tx,
        order.id,
        pricing.appliedOffers.map((offer) => ({ offerId: offer.offerId, discount: offer.discount })),
      );

      /* --- 7. issue the invoice from the order snapshot --------------------- */
      const { invoiceNumber, financialYear } = await nextInvoiceNumber(tx, now);
      await tx.invoice.create({
        data: {
          invoiceNumber,
          financialYear,
          orderId: order.id,
          status: "ISSUED",
          issuerName: env.COMPANY_NAME,
          issuerAddress: env.COMPANY_ADDRESS,
          issuerEmail: env.COMPANY_EMAIL,
          issuerPhone: env.COMPANY_PHONE,
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
        },
      });

      /* --- 8. empty the cart and close out the idempotency record ---------- */
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      await tx.idempotencyKey.update({
        where: { key: command.idempotencyKey },
        data: { orderId: order.id, status: "COMPLETED", responseHash: order.orderNumber },
      });

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        invoiceNumber,
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        total: pricing.total,
        stockCommitted: true,
        paymentRequired: false as const,
        notice: PAYMENT_NOTICE,
        items: pricing.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        })),
      };
    },
    {
      // Long enough for a slow catalogue read, short enough that a stalled
      // transaction does not accumulate row locks.
      timeout: 20_000,
      maxWait: 5_000,
    },
  );
}

/* ============================== order pricing ============================ */

interface TransactionPricing {
  lines: Array<
    PricingLine & {
      name: string;
      slug: string;
      sku: string;
      unitLabel: string;
      lineDiscount: number;
      lineTotal: number;
      offerId: number | null;
      offerName: string | null;
    }
  >;
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedOffers: Array<{ offerId: number; offerName: string; code: string | null; discount: number }>;
  rejections: Array<{ offerId: number; offerName: string; reason: string }>;
}

/**
 * Price the cart using only what this transaction can see, so an offer
 * expiring or a price changing mid-checkout cannot produce a torn result.
 */
async function priceWithinTransaction(
  tx: Tx,
  items: Array<{ productId: number; quantity: number }>,
  offerCode: string | null,
  now: Date,
): Promise<TransactionPricing> {
  const productIds = items.map((item) => item.productId);

  const catalogue = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      sku: true,
      unitLabel: true,
      price: true,
    },
  });
  const byId = new Map(catalogue.map((row) => [row.id, row]));

  const categoryIds = [...new Set(catalogue.map((row) => row.categoryId))];

  const candidateRows = await tx.offer.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      OR: [
        { scope: "ALL_PRODUCTS" },
        { scope: "PRODUCT", productId: { in: productIds } },
        { scope: "CATEGORY", categoryId: { in: categoryIds } },
      ],
    },
  });

  const candidates = candidateRows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    value: row.value,
    scope: row.scope,
    categoryId: row.categoryId,
    productId: row.productId,
    minOrderAmount: row.minOrderAmount,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  }));

  let selected = null;
  if (offerCode) {
    const row = await tx.offer.findUnique({ where: { code: offerCode } });
    if (!row) {
      throw new ValidationError(`Offer code "${offerCode}" is not recognised`, { offerCode });
    }
    selected = {
      id: row.id,
      name: row.name,
      code: row.code,
      type: row.type,
      value: row.value,
      scope: row.scope,
      categoryId: row.categoryId,
      productId: row.productId,
      minOrderAmount: row.minOrderAmount,
      usageLimit: row.usageLimit,
      usageCount: row.usageCount,
      isActive: row.isActive,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    };
  }

  const pricedLines = items.map((item) => {
    const row = byId.get(item.productId)!;
    return {
      productId: row.id,
      categoryId: row.categoryId,
      unitPrice: row.price,
      quantity: item.quantity,
    };
  });

  const evaluation = evaluateOffers({ lines: pricedLines, offers: candidates, selectedOffer: selected, now });

  const lines = pricedLines.map((line) => {
    const row = byId.get(line.productId)!;
    const discount = evaluation.lineDiscounts.get(line.productId);
    const lineSubtotal = multiplyMinor(line.unitPrice, line.quantity);
    const lineDiscount = discount?.discount ?? 0;
    return {
      productId: line.productId,
      categoryId: line.categoryId,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      name: row.name,
      slug: row.slug,
      sku: row.sku,
      unitLabel: row.unitLabel,
      lineDiscount,
      lineTotal: lineSubtotal - lineDiscount,
      offerId: discount?.offerId ?? null,
      offerName: discount?.offerName ?? null,
    };
  });

  return {
    lines,
    subtotal: evaluation.subtotal,
    discountTotal: evaluation.subtotal - evaluation.total,
    total: evaluation.total,
    appliedOffers: evaluation.appliedOffers,
    rejections: evaluation.rejections,
  };
}

/* ============================== order reading ============================ */

export interface ListOrdersQuery {
  page: number;
  pageSize: number;
  customerId?: number;
  status?: OrderStatus;
  search?: string;
  from?: Date;
  to?: Date;
}

export async function listOrders(query: ListOrdersQuery) {
  const where: Prisma.OrderWhereInput = {};

  if (query.customerId !== undefined) where.customerId = query.customerId;
  if (query.status) where.status = query.status;

  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  if (query.search) {
    // Escape LIKE wildcards so searching "100%" does not match everything.
    const term = query.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.OR = [
      { orderNumber: { contains: term } },
      { customerName: { contains: term } },
      { customerEmail: { contains: term } },
      { customerPhone: { contains: term } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        fulfilmentMethod: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        addressCity: true,
        subtotal: true,
        discountTotal: true,
        total: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  return paginate(
    rows.map((row) => ({ ...row, itemCount: row._count.items })),
    total,
    query.page,
    query.pageSize,
  );
}

export async function getOrderById(id: number, options: { customerId?: number } = {}) {
  const order = await prisma.order.findFirst({
    where: {
      id,
      ...(options.customerId !== undefined ? { customerId: options.customerId } : {}),
    },
    include: {
      items: true,
      invoices: {
        orderBy: { id: "asc" },
        select: { id: true, invoiceNumber: true, status: true, total: true, issuedAt: true },
      },
      statusHistory: { orderBy: { createdAt: "asc" } },
      customer: { select: { id: true, email: true, fullName: true } },
    },
  });

  if (!order) throw new NotFoundError("Order");
  return order;
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
  return prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
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
        for (const item of order.items) {
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

        await tx.invoice.updateMany({
          where: { orderId, status: { in: ["DRAFT", "ISSUED"] } },
          data: { status: "VOID", voidedAt: new Date(), voidReason: `Order ${to.toLowerCase()}` },
        });
      }

      const data: Prisma.OrderUpdateInput = { status: to };
      if (to === "CONFIRMED") data.confirmedAt = new Date();
      if (to === "DELIVERED") data.deliveredAt = new Date();
      if (to === "CANCELLED" || to === "REFUNDED") data.cancelledAt = new Date();

      await tx.order.update({ where: { id: orderId }, data });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: from,
          toStatus: to,
          note: options.note ?? "",
          changedBy: options.changedBy,
        },
      });

      return {
        orderId,
        orderNumber: order.orderNumber,
        from,
        to,
        stockRestored,
        allowedNext: ORDER_STATUS_TRANSITIONS[to],
      };
    },
    { timeout: 15_000 },
  );
}

export { ORDER_STATUS_TRANSITIONS };