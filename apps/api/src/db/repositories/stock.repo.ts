import { db, type Tx } from "../pool.js";

/**
 * Stock ledger and document-sequence data access.
 *
 * `stock_movements` is the source of truth; `products.stock_quantity` is a cache
 * written only in the same transaction as its ledger row. That is why the update
 * is conditional on the previously-read balance: a mismatch means another
 * transaction interleaved and the caller must retry rather than clobber it.
 */

export interface ProductStockRow {
  id: number;
  name: string;
  stockQuantity: number;
  allowBackorder: boolean;
  deletedAt: Date | null;
}

export function findProductStock(productId: number, conn: Tx = db): Promise<ProductStockRow | null> {
  return conn.queryOne<ProductStockRow>(
    `SELECT id, name, stock_quantity AS stockQuantity, allow_backorder AS allowBackorder,
            deleted_at AS deletedAt
       FROM products WHERE id = ?`,
    [productId],
  );
}

/** Compare-and-set the cached quantity; zero affected rows signals a lost race. */
export async function conditionalStockUpdate(
  productId: number,
  expected: number,
  next: number,
  conn: Tx = db,
): Promise<number> {
  const result = await conn.execute(
    "UPDATE products SET stock_quantity = ?, updated_at = NOW() WHERE id = ? AND stock_quantity = ?",
    [next, productId, expected],
  );
  return result.affectedRows;
}

/**
 * Take stock at order placement with a guard: zero affected rows means another
 * order consumed the stock first, so the caller aborts rather than overselling.
 */
export async function claimStock(productId: number, quantity: number, conn: Tx = db): Promise<number> {
  const result = await conn.execute(
    "UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = NOW() WHERE id = ? AND stock_quantity >= ?",
    [quantity, productId, quantity],
  );
  return result.affectedRows;
}

/** Unconditional decrement for products that allow backorder (balance may go negative). */
export async function decrementStock(productId: number, quantity: number, conn: Tx = db): Promise<number> {
  const result = await conn.execute(
    "UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = NOW() WHERE id = ?",
    [quantity, productId],
  );
  return result.affectedRows;
}

export async function readStockQuantity(productId: number, conn: Tx = db): Promise<number | null> {
  const row = await conn.queryOne<{ stockQuantity: number }>(
    "SELECT stock_quantity AS stockQuantity FROM products WHERE id = ?",
    [productId],
  );
  return row?.stockQuantity ?? null;
}

export interface ProductStockSnapshotRow {
  id: number;
  name: string;
  sku: string;
  stockQuantity: number;
  lowStockThreshold: number;
}

export function findProductStockSnapshot(
  productId: number,
  conn: Tx = db,
): Promise<ProductStockSnapshotRow | null> {
  return conn.queryOne<ProductStockSnapshotRow>(
    `SELECT id, name, sku, stock_quantity AS stockQuantity, low_stock_threshold AS lowStockThreshold
       FROM products WHERE id = ?`,
    [productId],
  );
}

export interface StockMovementListRow {
  id: number;
  productId: number;
  type: string;
  quantityChange: number;
  balanceAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdById: number | null;
  createdAt: Date;
  creatorId: number | null;
  creatorFullName: string | null;
  creatorEmail: string | null;
}

export async function countStockMovements(
  productId: number,
  type: string | undefined,
  conn: Tx = db,
): Promise<number> {
  const where = type ? "WHERE product_id = ? AND type = ?" : "WHERE product_id = ?";
  const params = type ? [productId, type] : [productId];
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM stock_movements ${where}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export function listStockMovementRows(
  productId: number,
  type: string | undefined,
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<StockMovementListRow[]> {
  const where = type ? "WHERE m.product_id = ? AND m.type = ?" : "WHERE m.product_id = ?";
  const params: unknown[] = type ? [productId, type, limit, offset] : [productId, limit, offset];
  return conn.query<StockMovementListRow>(
    `SELECT m.id, m.product_id AS productId, m.type, m.quantity_change AS quantityChange,
            m.balance_after AS balanceAfter, m.reference_type AS referenceType,
            m.reference_id AS referenceId, m.note, m.created_by_id AS createdById, m.created_at AS createdAt,
            a.id AS creatorId, a.full_name AS creatorFullName, a.email AS creatorEmail
       FROM stock_movements m
       LEFT JOIN admins a ON a.id = m.created_by_id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
    params,
  );
}

/* --------------------------- document sequences -------------------------- */

export async function ensureSequenceCounter(
  scope: string,
  period: string,
  prefix: string,
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    `INSERT IGNORE INTO sequence_counters (scope, period, last_value, prefix, updated_at)
     VALUES (?, ?, 0, ?, NOW(3))`,
    [scope, period, prefix],
  );
}

export function lockSequenceValue(
  scope: string,
  period: string,
  conn: Tx = db,
): Promise<{ lastValue: number } | null> {
  return conn.queryOne<{ lastValue: number }>(
    "SELECT last_value AS lastValue FROM sequence_counters WHERE scope = ? AND period = ? FOR UPDATE",
    [scope, period],
  );
}

export async function updateSequenceValue(
  scope: string,
  period: string,
  value: number,
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    "UPDATE sequence_counters SET last_value = ?, updated_at = NOW(3) WHERE scope = ? AND period = ?",
    [value, scope, period],
  );
}