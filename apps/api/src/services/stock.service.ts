import { Prisma } from "@prisma/client";
import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { sequenceSegment, currentFinancialYear } from "../lib/util.js";
import { env } from "../config/env.js";

type Tx = Prisma.TransactionClient;

/** Row shape returned by the sequence-counter query. */
type SequenceRow = { lastValue: number };

/**
 * Stock service.
 *
 * Two rules hold this module together:
 *
 *  1. `stock_movements` is the source of truth. `products.stockQuantity` is a
 *     cache that must always equal the sum of the ledger, and is only ever
 *     written alongside a ledger row inside the same transaction.
 *
 *  2. Stock is consumed when an order is CONFIRMED, not when it is added to a
 *     cart. Reservations create abandoned holds that need expiry machinery, and
 *     the oversell window it closes is smaller than the cost of that machinery.
 */

/**
 * Free-text reference kinds. `MANUAL` and `SUPPLIER` are entered by an admin;
 * `ORDER` is written by the checkout and cancellation paths. Stored as a string
 * rather than an enum so a new kind does not need a migration.
 */
export type StockReferenceType = "MANUAL" | "SUPPLIER" | "ORDER";

export interface AdjustStockInput {
  productId: number;
  quantityChange: number;
  type: "PURCHASE" | "ADJUSTMENT" | "RETURN" | "DAMAGE";
  referenceType: StockReferenceType;
  referenceId?: string | null;
  note?: string;
  createdById?: number | null;
}

/**
 * Apply a stock movement. MUST be called inside a transaction.
 *
 * The product row is locked with a conditional update so two concurrent
 * adjustments cannot interleave and produce a balance that matches neither
 * starting value.
 */
export async function applyStockMovement(tx: Tx, input: AdjustStockInput): Promise<number> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { id: true, stockQuantity: true, allowBackorder: true, name: true, deletedAt: true },
  });

  if (!product || product.deletedAt) throw new NotFoundError("Product");

  const balanceAfter = product.stockQuantity + input.quantityChange;

  // Backorder is opt-in per product; without it a negative balance is a bug,
  // not a supported state, so refuse the movement rather than record nonsense.
  if (balanceAfter < 0 && !product.allowBackorder) {
    throw new NotFoundError("Product");
  }

  const updated = await tx.product.updateMany({
    where: { id: input.productId, stockQuantity: product.stockQuantity },
    data: { stockQuantity: balanceAfter },
  });

  if (updated.count === 0) {
    // Another transaction moved this product between our read and write.
    throw new StockConflictError(product.name);
  }

  await tx.stockMovement.create({
    data: {
      productId: input.productId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter,
      referenceType: input.referenceType,
      referenceId: input.referenceId ?? null,
      note: input.note ?? "",
      createdById: input.createdById ?? null,
    },
  });

  return balanceAfter;
}

export class StockConflictError extends Error {
  constructor(productName: string) {
    super(`Stock for "${productName}" changed while this request was in progress. Please retry.`);
    this.name = "StockConflictError";
  }
}

/** Admin-facing manual adjustment, committed on its own. */
export async function adjustStock(input: AdjustStockInput, adminId: number) {
  return prisma.$transaction(async (tx) => {
    const balanceAfter = await applyStockMovement(tx, { ...input, createdById: adminId });

    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true, sku: true, stockQuantity: true, lowStockThreshold: true },
    });
    if (!product) throw new NotFoundError("Product");

    return {
      product,
      balanceAfter,
      isLowStock: product.stockQuantity <= product.lowStockThreshold,
    };
  });
}

export interface LedgerQuery {
  productId: number;
  page: number;
  pageSize: number;
  type?: string;
}

export async function listStockMovements(query: LedgerQuery): Promise<Paginated<unknown>> {
  const where: Prisma.StockMovementWhereInput = { productId: query.productId };
  if (query.type) where.type = query.type as Prisma.StockMovementWhereInput["type"];

  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { createdBy: { select: { id: true, fullName: true, email: true } } },
    }),
  ]);

  return paginate(rows, total, query.page, query.pageSize);
}

export interface LowStockItem {
  id: number;
  name: string;
  sku: string;
  stockQuantity: number;
  lowStockThreshold: number;
  unitLabel: string;
}

/** Row shape returned by the raw low-stock query. */
type LowStockRow = {
  id: number;
  name: string;
  sku: string;
  stockQuantity: number;
  lowStockThreshold: number;
  unitLabel: string;
};

/** Everything at or below its threshold, most urgent first. */
export async function findLowStockProducts(limit = 20): Promise<LowStockItem[]> {
  const rows = await prisma.$queryRaw<LowStockRow[]>(Prisma.sql`
    SELECT id, name, sku, stock_quantity AS stockQuantity,
           low_stock_threshold AS lowStockThreshold, unit_label AS unitLabel
    FROM products
    WHERE is_active = 1
      AND deleted_at IS NULL
      AND stock_quantity <= low_stock_threshold
      AND allow_backorder = 0
    ORDER BY (stock_quantity - low_stock_threshold) ASC, name ASC
    LIMIT ${limit}
  `);

  return rows;
}

/* ----------------------------- document numbers -------------------------- */

/**
 * Take the next value from a counter.
 *
 * `SELECT ... FOR UPDATE` holds a row lock for the remainder of the transaction,
 * so a second concurrent caller blocks here rather than reading the same value.
 * The counter row is created lazily; `INSERT IGNORE` makes that safe to race.
 *
 * Must be called inside a transaction that also writes the document using the
 * number, otherwise a crash between allocation and insert leaves a gap.
 */
async function nextSequenceValue(
  tx: Tx,
  scope: string,
  period: string,
  prefix: string,
): Promise<{ value: number; formatted: string }> {
  await tx.$executeRaw`
    INSERT IGNORE INTO sequence_counters (scope, period, last_value, prefix, updated_at)
    VALUES (${scope}, ${period}, 0, ${prefix}, NOW(3))
  `;

  const rows = await tx.$queryRaw<SequenceRow[]>(Prisma.sql`
    SELECT last_value AS lastValue
    FROM sequence_counters
    WHERE scope = ${scope} AND period = ${period}
    FOR UPDATE
  `);

  const current = rows[0];
  if (!current) {
    // The row was removed between the insert and the lock. Extremely unlikely,
    // but failing loudly beats issuing a duplicate number.
    throw new Error(`Sequence counter ${scope}/${period} could not be locked`);
  }

  const value = current.lastValue + 1;

  await tx.$executeRaw`
    UPDATE sequence_counters
    SET last_value = ${value}, updated_at = NOW(3)
    WHERE scope = ${scope} AND period = ${period}
  `;

  return { value, formatted: `${prefix}/${period}/${sequenceSegment(value)}` };
}

export async function nextInvoiceNumber(
  tx: Tx,
  issuedAt = new Date(),
): Promise<{ invoiceNumber: string; financialYear: string }> {
  const financialYear = currentFinancialYear(issuedAt);
  const { formatted } = await nextSequenceValue(tx, "INVOICE", financialYear, env.INVOICE_PREFIX);
  return { invoiceNumber: formatted, financialYear };
}

export async function nextOrderNumber(tx: Tx, createdAt = new Date()): Promise<string> {
  const financialYear = currentFinancialYear(createdAt);
  const { formatted } = await nextSequenceValue(tx, "ORDER", financialYear, "ORD");
  return formatted;
}