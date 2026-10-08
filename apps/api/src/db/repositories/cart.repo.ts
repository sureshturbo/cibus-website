import { db, type Tx } from "../pool.js";
import type { CartRow, ProductImageRow } from "../types.js";

/**
 * Cart data access.
 *
 * A cart row is identity only; the price a customer is shown is always read from
 * the live product, so nothing here stores money.
 */

export interface CartLineRow {
  productId: number;
  quantity: number;
  name: string;
  slug: string;
  sku: string;
  unitLabel: string;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  allowBackorder: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  categoryName: string | null;
  categorySlug: string | null;
}

export async function findCartByCustomerId(customerId: number, conn: Tx = db): Promise<{ id: number } | null> {
  return conn.queryOne<{ id: number }>("SELECT id FROM carts WHERE customer_id = ? LIMIT 1", [customerId]);
}

export async function findCartByToken(
  token: string,
  conn: Tx = db,
): Promise<{ id: number; expiresAt: Date | null } | null> {
  return conn.queryOne<{ id: number; expiresAt: Date | null }>(
    "SELECT id, expires_at AS expiresAt FROM carts WHERE token = ? LIMIT 1",
    [token],
  );
}

export async function insertCart(
  values: { customerId: number | null; token: string | null; expiresAt: Date | null },
  conn: Tx = db,
): Promise<{ id: number }> {
  const result = await conn.execute("INSERT INTO carts (customer_id, token, expires_at) VALUES (?, ?, ?)", [
    values.customerId,
    values.token,
    values.expiresAt,
  ]);
  return { id: result.insertId };
}

export async function findCartById(cartId: number, conn: Tx = db): Promise<CartRow | null> {
  return conn.queryOne<CartRow>(
    "SELECT id, token, customer_id AS customerId, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt FROM carts WHERE id = ?",
    [cartId],
  );
}

export async function countCartItems(cartId: number, conn: Tx = db): Promise<number> {
  const row = await conn.queryOne<{ count: number }>("SELECT COUNT(*) AS count FROM cart_items WHERE cart_id = ?", [
    cartId,
  ]);
  return Number(row?.count ?? 0);
}

export function listCartLineRows(cartId: number, conn: Tx = db): Promise<CartLineRow[]> {
  return conn.query<CartLineRow>(
    `SELECT ci.product_id AS productId, ci.quantity,
            p.name, p.slug, p.sku, p.unit_label AS unitLabel,
            p.price, p.compare_at_price AS compareAtPrice,
            p.stock_quantity AS stockQuantity, p.allow_backorder AS allowBackorder,
            p.is_active AS isActive, p.deleted_at AS deletedAt,
            c.name AS categoryName, c.slug AS categorySlug
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       LEFT JOIN categories c ON c.id = p.category_id
      WHERE ci.cart_id = ?
      ORDER BY ci.created_at ASC`,
    [cartId],
  );
}

/** First image per product, ordered as the card view expects. */
export async function firstImagesForProductIds(
  productIds: number[],
  conn: Tx = db,
): Promise<Map<number, ProductImageRow>> {
  if (productIds.length === 0) return new Map();
  const rows = await conn.query<ProductImageRow>(
    `SELECT i.id, i.product_id AS productId, i.url, i.alt_text AS altText,
            i.is_primary AS isPrimary, i.sort_order AS sortOrder, i.created_at AS createdAt
       FROM product_images i
      WHERE i.product_id IN (${productIds.map(() => "?").join(",")})
      ORDER BY i.product_id ASC, i.sort_order ASC, i.created_at ASC`,
    productIds,
  );
  const byProduct = new Map<number, ProductImageRow>();
  for (const row of rows) {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, row);
  }
  return byProduct;
}

export interface CartItemRef {
  id: number;
  productId: number;
  quantity: number;
}

export async function findCartItem(
  cartId: number,
  productId: number,
  conn: Tx = db,
): Promise<CartItemRef | null> {
  return conn.queryOne<CartItemRef>(
    "SELECT id, product_id AS productId, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?",
    [cartId, productId],
  );
}

export function listCartItemRows(cartId: number, conn: Tx = db): Promise<CartItemRef[]> {
  return conn.query<CartItemRef>(
    "SELECT id, product_id AS productId, quantity FROM cart_items WHERE cart_id = ?",
    [cartId],
  );
}

export async function upsertCartItem(
  cartId: number,
  productId: number,
  createQuantity: number,
  updateQuantity: number,
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    `INSERT INTO cart_items (cart_id, product_id, quantity)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = ?, updated_at = NOW()`,
    [cartId, productId, createQuantity, updateQuantity],
  );
}

export async function updateCartItemQuantity(id: number, quantity: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE cart_items SET quantity = ?, updated_at = NOW() WHERE id = ?", [quantity, id]);
}

export async function deleteCartItem(cartId: number, productId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?", [cartId, productId]);
}

export async function deleteCartItems(cartId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
}

export async function deleteCart(cartId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM carts WHERE id = ?", [cartId]);
}