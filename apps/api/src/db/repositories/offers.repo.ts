import { db, type Tx } from "../pool.js";
import type { OfferRow } from "../types.js";

/**
 * Offer data access. Reads attach the category/product name a list view shows
 * and a redemption count, so the service never issues a follow-up query per row.
 */

export const OFFER_COLUMNS = `
  o.id, o.name, o.code, o.type, o.value, o.scope,
  o.category_id AS categoryId, o.product_id AS productId,
  o.min_order_amount AS minOrderAmount,
  o.starts_at AS startsAt, o.ends_at AS endsAt,
  o.usage_limit AS usageLimit, o.usage_count AS usageCount,
  o.is_active AS isActive, o.created_at AS createdAt, o.updated_at AS updatedAt
`;

export interface OfferListRow extends OfferRow {
  categoryRefId: number | null;
  categoryRefName: string | null;
  productRefId: number | null;
  productRefName: string | null;
  redemptionCount: number;
}

export interface OfferDetailRow extends OfferRow {
  categoryRefId: number | null;
  categoryRefName: string | null;
  categoryRefSlug: string | null;
  productRefId: number | null;
  productRefName: string | null;
  productRefSlug: string | null;
  redemptionCount: number;
}

export async function countOffers(
  whereSql: string,
  params: readonly unknown[],
  conn: Tx = db,
): Promise<number> {
  const row = await conn.queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM offers o ${whereSql}`,
    params,
  );
  return Number(row?.total ?? 0);
}

export async function listOfferRows(
  whereSql: string,
  params: readonly unknown[],
  limit: number,
  offset: number,
  conn: Tx = db,
): Promise<OfferListRow[]> {
  return conn.query<OfferListRow>(
    `SELECT ${OFFER_COLUMNS},
       cat.id AS categoryRefId, cat.name AS categoryRefName,
       prod.id AS productRefId, prod.name AS productRefName,
       (SELECT COUNT(*) FROM offer_redemptions r WHERE r.offer_id = o.id) AS redemptionCount
     FROM offers o
     LEFT JOIN categories cat ON cat.id = o.category_id
     LEFT JOIN products prod ON prod.id = o.product_id
     ${whereSql}
     ORDER BY o.starts_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export async function findOfferDetailById(
  id: number,
  conn: Tx = db,
): Promise<OfferDetailRow | null> {
  return conn.queryOne<OfferDetailRow>(
    `SELECT ${OFFER_COLUMNS},
       cat.id AS categoryRefId, cat.name AS categoryRefName, cat.slug AS categoryRefSlug,
       prod.id AS productRefId, prod.name AS productRefName, prod.slug AS productRefSlug,
       (SELECT COUNT(*) FROM offer_redemptions r WHERE r.offer_id = o.id) AS redemptionCount
     FROM offers o
     LEFT JOIN categories cat ON cat.id = o.category_id
     LEFT JOIN products prod ON prod.id = o.product_id
     WHERE o.id = ?`,
    [id],
  );
}

export async function findOfferRowById(id: number, conn: Tx = db): Promise<OfferRow | null> {
  return conn.queryOne<OfferRow>(`SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.id = ?`, [id]);
}

export async function findOfferRowByCode(code: string, conn: Tx = db): Promise<OfferRow | null> {
  return conn.queryOne<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.code = ? LIMIT 1`,
    [code],
  );
}

export async function loadCandidateOfferRows(
  productIds: number[],
  categoryIds: number[],
  now: Date,
  conn: Tx = db,
): Promise<OfferRow[]> {
  const scopes = ["o.scope = 'ALL_PRODUCTS'"];
  const params: unknown[] = [now, now];

  if (productIds.length > 0) {
    scopes.push(`(o.scope = 'PRODUCT' AND o.product_id IN (${productIds.map(() => "?").join(",")}))`);
    params.push(...productIds);
  }
  if (categoryIds.length > 0) {
    scopes.push(`(o.scope = 'CATEGORY' AND o.category_id IN (${categoryIds.map(() => "?").join(",")}))`);
    params.push(...categoryIds);
  }

  return conn.query<OfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM offers o
     WHERE o.is_active = 1 AND o.starts_at <= ? AND o.ends_at >= ?
       AND (${scopes.join(" OR ")})`,
    params,
  );
}

export interface InsertOfferValues {
  name: string;
  code: string | null;
  type: string;
  value: number;
  scope: string;
  categoryId: number | null;
  productId: number | null;
  minOrderAmount: number;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  isActive: boolean;
}

export async function insertOffer(values: InsertOfferValues, conn: Tx = db): Promise<OfferRow> {
  const result = await conn.execute(
    `INSERT INTO offers
       (name, code, type, value, scope, category_id, product_id, min_order_amount,
        starts_at, ends_at, usage_limit, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.name,
      values.code,
      values.type,
      values.value,
      values.scope,
      values.categoryId,
      values.productId,
      values.minOrderAmount,
      values.startsAt,
      values.endsAt,
      values.usageLimit,
      values.isActive,
    ],
  );
  const row = await findOfferRowById(result.insertId, conn);
  if (!row) throw new Error("Inserted offer could not be read back");
  return row;
}

export async function updateOfferRow(
  id: number,
  values: {
    name?: string;
    startsAt?: Date;
    endsAt?: Date;
    usageLimit?: number | null;
    isActive?: boolean;
  },
  conn: Tx = db,
): Promise<OfferRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (values.name !== undefined) {
    sets.push("name = ?");
    params.push(values.name);
  }
  if (values.startsAt !== undefined) {
    sets.push("starts_at = ?");
    params.push(values.startsAt);
  }
  if (values.endsAt !== undefined) {
    sets.push("ends_at = ?");
    params.push(values.endsAt);
  }
  if (values.usageLimit !== undefined) {
    sets.push("usage_limit = ?");
    params.push(values.usageLimit);
  }
  if (values.isActive !== undefined) {
    sets.push("is_active = ?");
    params.push(values.isActive);
  }
  sets.push("updated_at = NOW()");
  params.push(id);
  await conn.execute(`UPDATE offers SET ${sets.join(", ")} WHERE id = ?`, params);
  const row = await findOfferRowById(id, conn);
  if (!row) throw new Error("Updated offer could not be read back");
  return row;
}

export async function setOfferActiveRow(
  id: number,
  isActive: boolean,
  conn: Tx = db,
): Promise<OfferRow> {
  await conn.execute("UPDATE offers SET is_active = ?, updated_at = NOW() WHERE id = ?", [
    isActive,
    id,
  ]);
  const row = await findOfferRowById(id, conn);
  if (!row) throw new Error("Updated offer could not be read back");
  return row;
}

/* ------------------------------- redemptions ----------------------------- */

export async function insertOfferRedemption(
  values: { offerId: number; orderId: number; discount: number },
  conn: Tx = db,
): Promise<void> {
  await conn.execute(
    "INSERT INTO offer_redemptions (offer_id, order_id, discount) VALUES (?, ?, ?)",
    [values.offerId, values.orderId, values.discount],
  );
}

export async function incrementOfferUsage(id: number, delta: number, conn: Tx = db): Promise<void> {
  await conn.execute("UPDATE offers SET usage_count = usage_count + ? WHERE id = ?", [delta, id]);
}

export function findRedemptionsByOrder(
  orderId: number,
  conn: Tx = db,
): Promise<Array<{ offerId: number }>> {
  return conn.query<{ offerId: number }>(
    "SELECT offer_id AS offerId FROM offer_redemptions WHERE order_id = ?",
    [orderId],
  );
}

export async function deleteRedemptionsByOrder(orderId: number, conn: Tx = db): Promise<void> {
  await conn.execute("DELETE FROM offer_redemptions WHERE order_id = ?", [orderId]);
}