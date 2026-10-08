import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError } from "../lib/errors.js";
import { db, transaction, type Tx } from "../db/pool.js";
import { env } from "../config/env.js";
import { sequenceSegment, currentFinancialYear } from "../lib/util.js";
import { insertStockMovement } from "../db/repositories/catalog.repo.js";
import {
  conditionalStockUpdate,
  countStockMovements,
  ensureSequenceCounter,
  findProductStock,
  findProductStockSnapshot,
  listStockMovementRows,
  lockSequenceValue,
  updateSequenceValue,
} from "../db/repositories/stock.repo.js";

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
  const product = await findProductStock(input.productId, tx);

  if (!product || product.deletedAt) throw new NotFoundError("Product");

  const balanceAfter = product.stockQuantity + input.quantityChange;

  // Backorder is opt-in per product; without it a negative balance is a bug,
  // not a supported state, so refuse the movement rather than record nonsense.
  if (balanceAfter < 0 && !product.allowBackorder) {
    throw new NotFoundError("Product");
  }

  const affected = await conditionalStockUpdate(input.productId, product.stockQuantity, balanceAfter, tx);

  if (affected === 0) {
    // Another transaction moved this product between our read and write.
    throw new StockConflictError(product.name);
  }

  await insertStockMovement(
    {
      productId: input.productId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter,
      referenceType: input.referenceType,
      referenceId: input.referenceId ?? null,
      note: input.note ?? "",
      createdById: input.createdById ?? null,
    },
    tx,
  );

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
  return transaction(async (tx) => {
    const balanceAfter = await applyStockMovement(tx, { ...input, createdById: adminId });

    const product = await findProductStockSnapshot(input.productId, tx);
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
  const offset = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countStockMovements(query.productId, query.type),
    listStockMovementRows(query.productId, query.type, query.pageSize, offset),
  ]);

  const items = rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    type: row.type,
    quantityChange: row.quantityChange,
    balanceAfter: row.balanceAfter,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    note: row.note,
    createdById: row.createdById,
    createdAt: row.createdAt,
    createdBy:
      row.creatorId !== null
        ? { id: row.creatorId, fullName: row.creatorFullName, email: row.creatorEmail }
        : null,
  }));

  return paginate(items, total, query.page, query.pageSize);
}

export interface LowStockItem {
  id: number;
  name: string;
  sku: string;
  stockQuantity: number;
  lowStockThreshold: number;
  unitLabel: string;
}

/** Everything at or below its threshold, most urgent first. */
export async function findLowStockProducts(limit = 20): Promise<LowStockItem[]> {
  return db.query<LowStockItem>(
    `SELECT id, name, sku, stock_quantity AS stockQuantity,
            low_stock_threshold AS lowStockThreshold, unit_label AS unitLabel
       FROM products
      WHERE is_active = 1
        AND deleted_at IS NULL
        AND stock_quantity <= low_stock_threshold
        AND allow_backorder = 0
      ORDER BY (stock_quantity - low_stock_threshold) ASC, name ASC
      LIMIT ?`,
    [limit],
  );
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
  await ensureSequenceCounter(scope, period, prefix, tx);

  const current = await lockSequenceValue(scope, period, tx);
  if (!current) {
    // The row was removed between the insert and the lock. Extremely unlikely,
    // but failing loudly beats issuing a duplicate number.
    throw new Error(`Sequence counter ${scope}/${period} could not be locked`);
  }

  const value = current.lastValue + 1;
  await updateSequenceValue(scope, period, value, tx);

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