import type {
  CategoryRow,
  ProductImageRow,
  ProductRow,
  StockMovementRow,
} from "../types.js";
import { db, type Tx } from "../pool.js";

/**
 * Catalogue data access (categories, products, images, stock movements).
 *
 * Every SELECT aliases the snake_case columns to the camelCase keys the rest of
 * the app speaks, so a row is interchange- able with the object Prisma used to
 * return without a second mapping pass. Writes accept a `Tx` so a caller can run
 * several statements in one transaction.
 */

export const CATEGORY_COLUMNS = `
  c.id, c.parent_id AS parentId, c.name, c.slug, c.description,
  c.image_url AS imageUrl, c.sort_order AS sortOrder, c.is_active AS isActive,
  c.created_at AS createdAt, c.updated_at AS updatedAt
`;

export const PRODUCT_COLUMNS = `
  p.id, p.category_id AS categoryId, p.name, p.slug, p.sku,
  p.short_description AS shortDescription, p.description, p.unit_label AS unitLabel,
  p.price, p.compare_at_price AS compareAtPrice, p.stock_quantity AS stockQuantity,
  p.low_stock_threshold AS lowStockThreshold, p.allow_backorder AS allowBackorder,
  p.is_active AS isActive, p.is_featured AS isFeatured, p.deleted_at AS deletedAt,
  p.created_at AS createdAt, p.updated_at AS updatedAt
`;

export const IMAGE_COLUMNS = `
  i.id, i.product_id AS productId, i.url, i.alt_text AS altText,
  i.is_primary AS isPrimary, i.sort_order AS sortOrder, i.created_at AS createdAt
`;

export const STOCK_MOVEMENT_COLUMNS = `
  m.id, m.product_id AS productId, m.type, m.quantity_change AS quantityChange,
  m.balance_after AS balanceAfter, m.reference_type AS referenceType,
  m.reference_id AS referenceId, m.note, m.created_by_id AS createdById,
  m.created_at AS createdAt
`;

export interface CategoryCountRow extends CategoryRow {
  productCount: number;
}

export interface CategoryDetailRow extends CategoryRow {
  productCount: number;
  childCount: number;
}

export interface CategoryParentRow {
  parentId: number | null;
}

export interface CategoryRefCountsRow {
  id: number;
  products: number;
  children: number;
  offers: number;
}

/* ------------------------------- categories ------------------------------ */

export async function listCategoryRows(
  includeInactive: boolean,
  conn: Tx = db,
): Promise<CategoryCountRow[]> {
  const where = includeInactive ? "" : "WHERE c.is_active = 1";
  return conn.query<CategoryCountRow>(`
    SELECT ${CATEGORY_COLUMNS},
      (SELECT COUNT(*) FROM products p
        WHERE p.category_id = c.id AND p.is_active = 1 AND p.deleted_at IS NULL) AS productCount
    FROM categories c
    ${where}
    ORDER BY c.sort_order ASC, c.name ASC
  `);
}

export async function getCategoryWithCounts(
  id: number,
  conn: Tx = db,
): Promise<CategoryDetailRow | null> {
  return conn.queryOne<CategoryDetailRow>(
    `SELECT ${CATEGORY_COLUMNS},
       (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productCount,
       (SELECT COUNT(*) FROM categories ch WHERE ch.parent_id = c.id) AS childCount
     FROM categories c WHERE c.id = ?`,
    [id],
  );
}

export async function findCategoryBySlugActive(
  slug: string,
  conn: Tx = db,
): Promise<CategoryRow | null> {
  return conn.queryOne<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.slug = ? AND c.is_active = 1 LIMIT 1`,
    [slug],
  );
}

export async function findCategoryById(id: number, conn: Tx = db): Promise<CategoryRow | null> {
  return conn.queryOne<CategoryRow>(`SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.id = ?`, [id]);
}

export async function categoriesByIds(ids: number[], conn: Tx = db): Promise<CategoryRow[]> {
  if (ids.length === 0) return [];
  return conn.query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
}

export interface TopLevelCategoryRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  productCount: number;
}

export async function listTopLevelCategoryRows(conn: Tx = db): Promise<TopLevelCategoryRow[]> {
  return conn.query<TopLevelCategoryRow>(
    `SELECT c.id, c.name, c.slug, c.description, c.image_url AS imageUrl,
       (SELECT COUNT(*) FROM products p
         WHERE p.category_id = c.id AND p.is_active = 1 AND p.deleted_at IS NULL) AS productCount
     FROM categories c
     WHERE c.is_active = 1 AND c.parent_id IS NULL
     ORDER BY c.sort_order ASC, c.name ASC`,
  );
}

export async function listChildCategoryRows(
  parentId: number,
  conn: Tx = db,
): Promise<CategoryRow[]> {
  return conn.query<CategoryRow>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories c WHERE c.parent_id = ? ORDER BY c.sort_order ASC, c.name ASC`,
    [parentId],
  );
}

export async function findCategoryParent(
  id: number,
  conn: Tx = db,
): Promise<CategoryParentRow | null> {
  return conn.queryOne<CategoryParentRow>(
    "SELECT c.parent_id AS parentId FROM categories c WHERE c.id = ?",
    [id],
  );
}

export async function findCategoryIdBySlug(slug: string, conn: Tx = db): Promise<number | null> {
  const row = await conn.queryOne<{ id: number }>(
    "SELECT c.id FROM categories c WHERE c.slug = ? LIMIT 1",
    [slug],
  );
  return row?.id ?? null;
}

export async function categorySlugExists(slug: string, conn: Tx = db): Promise<boolean> {
  const row = await conn.queryOne<{ id: number }>(
    "SELECT c.id FROM categories c WHERE c.slug = ? LIMIT 1",
    [slug],
  );
  return row !== null;
}

const CATEGORY_UPDATE_COLUMNS: Record<string, string> = {
  name: "name",
  slug: "slug",
  parentId: "parent_id",
  description: "description",
  imageUrl: "image_url",
  sortOrder: "sort_order",
  isActive: "is_active",
};

export async function insertCategory(
  values: {
    name: string;
    slug: string;
    parentId: number | null;
    description: string;
    imageUrl: string | null;
    sortOrder: number;
    isActive: boolean;
  },
  conn: Tx = db,
): Promise<CategoryRow> {
  const result = await conn.execute(
    `INSERT INTO categories (name, slug, parent_id, description, image_url, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      values.name,
      values.slug,
      values.parentId,
      values.description,
      values.imageUrl,
      values.sortOrder,
      values.isActive,
    ],
  );
  const row = await findCategoryById(result.insertId, conn);
  if (!row) throw new Error("Inserted category could not be read back");
  return row;
}

export async function updateCategoryRow(
  id: number,
  values: Record<string, unknown>,
  conn: Tx = db,
): Promise<CategoryRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(CATEGORY_UPDATE_COLUMNS)) {
    if (key in values) {
      sets.push(`${column} = ?`);
      params.push((values as Record<string, unknown>)[key]);
    }
  }
  sets.push("updated_at = NOW()");
  params.push(id);
  await conn.execute(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, params);

  const row = await findCategoryById(id, conn);
  if (!row) throw new Error("Updated category could not be read back");
  return row;
}

export async function categoryDeleteRefs(
  id: number,
  conn: Tx = db,
): Promise<CategoryRefCountsRow | null> {
  return conn.queryOne<CategoryRefCountsRow>(
    `SELECT c.id,
       (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products,
       (SELECT COUNT(*) FROM categories ch WHERE ch.parent_id = c.id) AS children,
       (SELECT COUNT(*) FROM offers o WHERE o.category_id = c.id) AS offers
     FROM categories c WHERE c.id = ?`,
    [id],
  );
}

export async function deleteCategoryRow(id: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM categories WHERE id = ?", [id]);
}

/* -------------------------------- products ------------------------------- */

export async function countProducts(
  whereSql: string,
  params: readonly unknown[],
  conn: Tx = db,
): Promise<number> {
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM products p ${whereSql}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export async function listProductRows(
  whereSql: string,
  params: readonly unknown[],
  orderBySql: string,
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<ProductRow[]> {
  return conn.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products p ${whereSql} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export async function findProductById(id: number, conn: Tx = db): Promise<ProductRow | null> {
  return conn.queryOne<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ?`, [id]);
}

export async function findProductsByIds(ids: number[], conn: Tx = db): Promise<ProductRow[]> {
  if (ids.length === 0) return [];
  return conn.query<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
}

/** The id/stock subset a cart add or quantity change needs to validate against. */
export async function findActiveProductStock(
  id: number,
  conn: Tx = db,
): Promise<{ id: number; stockQuantity: number; allowBackorder: boolean } | null> {
  return conn.queryOne<{ id: number; stockQuantity: number; allowBackorder: boolean }>(
    "SELECT id, stock_quantity AS stockQuantity, allow_backorder AS allowBackorder FROM products WHERE id = ? AND is_active = 1 AND deleted_at IS NULL",
    [id],
  );
}

export async function findActiveProductBySlug(
  slug: string,
  conn: Tx = db,
): Promise<ProductRow | null> {
  return conn.queryOne<ProductRow>(
    `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.slug = ? AND p.is_active = 1 AND p.deleted_at IS NULL LIMIT 1`,
    [slug],
  );
}

export async function findProductIdBySlug(slug: string, conn: Tx = db): Promise<number | null> {
  const row = await conn.queryOne<{ id: number }>(
    "SELECT p.id FROM products p WHERE p.slug = ? LIMIT 1",
    [slug],
  );
  return row?.id ?? null;
}

export async function productSlugExists(slug: string, conn: Tx = db): Promise<boolean> {
  const row = await conn.queryOne<{ id: number }>(
    "SELECT p.id FROM products p WHERE p.slug = ? LIMIT 1",
    [slug],
  );
  return row !== null;
}

export async function lowStockProductIdRows(conn: Tx = db): Promise<Array<{ id: number }>> {
  return conn.query<{ id: number }>(
    "SELECT id FROM products WHERE is_active = 1 AND deleted_at IS NULL AND stock_quantity <= low_stock_threshold",
  );
}

const PRODUCT_UPDATE_COLUMNS: Record<string, string> = {
  name: "name",
  slug: "slug",
  categoryId: "category_id",
  sku: "sku",
  shortDescription: "short_description",
  description: "description",
  unitLabel: "unit_label",
  price: "price",
  compareAtPrice: "compare_at_price",
  stockQuantity: "stock_quantity",
  lowStockThreshold: "low_stock_threshold",
  isActive: "is_active",
  isFeatured: "is_featured",
  deletedAt: "deleted_at",
};

export async function insertProduct(
  values: {
    name: string;
    slug: string;
    categoryId: number;
    sku: string;
    shortDescription: string;
    description: string;
    unitLabel: string;
    price: number;
    compareAtPrice: number | null;
    lowStockThreshold: number;
    isActive: boolean;
    isFeatured: boolean;
  },
  conn: Tx = db,
): Promise<number> {
  const result = await conn.execute(
    `INSERT INTO products
       (category_id, name, slug, sku, short_description, description, unit_label,
        price, compare_at_price, low_stock_threshold, is_active, is_featured)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.categoryId,
      values.name,
      values.slug,
      values.sku,
      values.shortDescription,
      values.description,
      values.unitLabel,
      values.price,
      values.compareAtPrice,
      values.lowStockThreshold,
      values.isActive,
      values.isFeatured,
    ],
  );
  return result.insertId;
}

export async function updateProductRow(
  id: number,
  values: Record<string, unknown>,
  conn: Tx = db,
): Promise<ProductRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(PRODUCT_UPDATE_COLUMNS)) {
    if (key in values) {
      sets.push(`${column} = ?`);
      params.push(values[key]);
    }
  }
  if (sets.length > 0) {
    await conn.execute(
      `UPDATE products SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`,
      [...params, id],
    );
  }
  const row = await findProductById(id, conn);
  if (!row) throw new Error("Updated product could not be read back");
  return row;
}

export async function deleteCartItemsForProduct(productId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM cart_items WHERE product_id = ?", [productId]);
}

export async function insertStockMovement(
  values: {
    productId: number;
    type: string;
    quantityChange: number;
    balanceAfter: number;
    referenceType: string;
    referenceId?: string | null;
    note: string;
    createdById: number | null;
  },
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    `INSERT INTO stock_movements
       (product_id, type, quantity_change, balance_after, reference_type, reference_id, note, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.productId,
      values.type,
      values.quantityChange,
      values.balanceAfter,
      values.referenceType,
      values.referenceId ?? null,
      values.note,
      values.createdById,
    ],
  );
}

export async function listStockMovements(
  productId: number,
  limit: number,
  conn: Tx = db,
): Promise<StockMovementRow[]> {
  return conn.query<StockMovementRow>(
    `SELECT ${STOCK_MOVEMENT_COLUMNS} FROM stock_movements m
     WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT ?`,
    [productId, limit],
  );
}

export async function adminsByIds(ids: number[], conn: Tx = db): Promise<Array<{ id: number; fullName: string }>> {
  if (ids.length === 0) return [];
  return conn.query<{ id: number; fullName: string }>(
    `SELECT a.id, a.full_name AS fullName FROM admins a WHERE a.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
}

export async function productRefCounts(
  id: number,
  conn: Tx = db,
): Promise<{ orderItems: number; cartItems: number }> {
  const row = await conn.queryOne<{ orderItems: number; cartItems: number }>(
    `SELECT
       (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = ?) AS orderItems,
       (SELECT COUNT(*) FROM cart_items ci WHERE ci.product_id = ?) AS cartItems`,
    [id, id],
  );
  return { orderItems: Number(row?.orderItems ?? 0), cartItems: Number(row?.cartItems ?? 0) };
}

/* --------------------------------- images -------------------------------- */

export async function imagesForProductIds(
  productIds: number[],
  conn: Tx = db,
): Promise<ProductImageRow[]> {
  if (productIds.length === 0) return [];
  return conn.query<ProductImageRow>(
    `SELECT ${IMAGE_COLUMNS} FROM product_images i
     WHERE i.product_id IN (${productIds.map(() => "?").join(",")})
     ORDER BY i.sort_order ASC, i.created_at ASC`,
    productIds,
  );
}

export async function findProductImage(
  imageId: number,
  conn: Tx = db,
): Promise<ProductImageRow | null> {
  return conn.queryOne<ProductImageRow>(
    `SELECT ${IMAGE_COLUMNS} FROM product_images i WHERE i.id = ?`,
    [imageId],
  );
}

export async function insertProductImage(
  values: {
    productId: number;
    url: string;
    altText: string;
    isPrimary: boolean;
    sortOrder: number;
  },
  conn: Tx = db,
): Promise<ProductImageRow> {
  const result = await conn.execute(
    `INSERT INTO product_images (product_id, url, alt_text, is_primary, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [values.productId, values.url, values.altText, values.isPrimary, values.sortOrder],
  );
  const row = await findProductImage(result.insertId, conn);
  if (!row) throw new Error("Inserted image could not be read back");
  return row;
}

export async function deleteProductImageRow(imageId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM product_images WHERE id = ?", [imageId]);
}

export async function findFirstProductImage(
  productId: number,
  conn: Tx = db,
): Promise<ProductImageRow | null> {
  return conn.queryOne<ProductImageRow>(
    `SELECT ${IMAGE_COLUMNS} FROM product_images i
     WHERE i.product_id = ? ORDER BY i.sort_order ASC, i.created_at ASC LIMIT 1`,
    [productId],
  );
}

export async function setPrimaryImage(imageId: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE product_images SET is_primary = 1 WHERE id = ?", [imageId]);
}

export async function clearPrimaryImages(productId: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE product_images SET is_primary = 0 WHERE product_id = ?", [productId]);
}

export async function updateImageOrder(
  id: number,
  productId: number,
  sortOrder: number,
  isPrimary: boolean,
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    "UPDATE product_images SET sort_order = ?, is_primary = ? WHERE id = ? AND product_id = ?",
    [sortOrder, isPrimary, id, productId],
  );
}

export type { CategoryRow, ProductRow, ProductImageRow };