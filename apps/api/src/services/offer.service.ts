import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { percentToBasisPoints, type OfferScope as SharedScope, type OfferType as SharedType } from "@cibus/shared";
import { toMinor, assertStorableMinor } from "@cibus/shared";
import type { Tx } from "../db/pool.js";
import { findCategoryById, findProductById } from "../db/repositories/catalog.repo.js";
import {
  countOffers,
  deleteRedemptionsByOrder,
  findOfferDetailById,
  findOfferRowByCode,
  findOfferRowById,
  findRedemptionsByOrder,
  incrementOfferUsage,
  insertOffer,
  insertOfferRedemption,
  listOfferRows,
  loadCandidateOfferRows,
  setOfferActiveRow,
  updateOfferRow,
} from "../db/repositories/offers.repo.js";

import { toEvaluationOffer } from "./selects.js";

/**
 * Offer creation, listing and evaluation.
 *
 * All arithmetic delegates to the pure evaluator in @cibus/shared so the rules
 * are unit-testable without a database, and so checkout and the storefront
 * preview can never disagree about what an order costs.
 *
 * Redemption bookkeeping (`recordRedemptions` / `releaseRedemptions`) takes the
 * checkout transaction's connection so a rolled-back order leaves usage counts
 * untouched.
 */

export interface CreateOfferInput {
  name: string;
  code?: string | null;
  type: SharedType;
  /** Percent figure for PERCENTAGE, currency figure for FIXED_AMOUNT. */
  value: string;
  scope: SharedScope;
  categoryId?: number | null;
  productId?: number | null;
  minOrderAmount?: string | null;
  startsAt: Date;
  endsAt: Date;
  usageLimit?: number | null;
  isActive: boolean;
}

/**
 * Convert a submitted percentage or currency figure into the integer storage
 * convention: basis points for percentages, paise for fixed amounts.
 */
export function encodeOfferValue(type: SharedType, raw: string): number {
  if (type === "PERCENTAGE") {
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new ValidationError("A percentage discount must be between 0 and 100");
    }
    return percentToBasisPoints(percent);
  }
  return assertStorableMinor(toMinor(raw), "Offer value");
}

/** The stored offer columns, in the shape the admin view expects. */
function offerFields(row: {
  id: number;
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
  usageCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    value: row.value,
    scope: row.scope,
    categoryId: row.categoryId,
    productId: row.productId,
    minOrderAmount: row.minOrderAmount,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    usageLimit: row.usageLimit,
    usageCount: row.usageCount,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createOffer(input: CreateOfferInput) {
  const code = input.code?.trim().toUpperCase() || null;

  if (code) {
    const clash = await findOfferRowByCode(code);
    if (clash) throw new ValidationError("That offer code is already in use");
  }

  if (input.scope === "CATEGORY" && input.categoryId) {
    const category = await findCategoryById(input.categoryId);
    if (!category) throw new ValidationError("The selected category does not exist");
  }
  if (input.scope === "PRODUCT" && input.productId) {
    const product = await findProductById(input.productId);
    if (!product || product.deletedAt) throw new ValidationError("The selected product does not exist");
  }

  return insertOffer({
    name: input.name,
    code,
    type: input.type,
    value: encodeOfferValue(input.type, input.value),
    scope: input.scope,
    categoryId: input.scope === "CATEGORY" ? (input.categoryId ?? null) : null,
    productId: input.scope === "PRODUCT" ? (input.productId ?? null) : null,
    minOrderAmount: input.minOrderAmount
      ? assertStorableMinor(toMinor(input.minOrderAmount), "Minimum order amount")
      : 0,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    usageLimit: input.usageLimit ?? null,
    isActive: input.isActive,
  });
}

export interface ListOffersQuery {
  page: number;
  pageSize: number;
  status?: "all" | "active" | "scheduled" | "expired";
  search?: string;
}

export async function listOffers(query: ListOffersQuery): Promise<Paginated<unknown>> {
  const now = new Date();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.status === "active") {
    clauses.push("o.is_active = 1", "o.starts_at <= ?", "o.ends_at >= ?");
    params.push(now, now);
  } else if (query.status === "scheduled") {
    clauses.push("o.starts_at > ?");
    params.push(now);
  } else if (query.status === "expired") {
    clauses.push("o.ends_at < ?");
    params.push(now);
  }

  if (query.search) {
    clauses.push("(o.name LIKE ? OR o.code LIKE ?)");
    params.push(`%${query.search}%`, `%${query.search.toUpperCase()}%`);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const offset = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    countOffers(whereSql, params),
    listOfferRows(whereSql, params, query.pageSize, offset),
  ]);

  const items = rows.map((row) => ({
    ...offerFields(row),
    category: row.categoryRefId !== null ? { id: row.categoryRefId, name: row.categoryRefName } : null,
    product: row.productRefId !== null ? { id: row.productRefId, name: row.productRefName } : null,
    _count: { redemptions: Number(row.redemptionCount) },
    percentValue: row.type === "PERCENTAGE" ? row.value / 100 : null,
    derivedStatus: deriveOfferStatus(
      { isActive: row.isActive, startsAt: row.startsAt, endsAt: row.endsAt, usageCount: row.usageCount, usageLimit: row.usageLimit },
      now,
    ),
  }));

  return paginate(items, total, query.page, query.pageSize);
}

export type DerivedOfferStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "EXHAUSTED" | "DISABLED";

export function deriveOfferStatus(
  offer: { isActive: boolean; startsAt: Date; endsAt: Date; usageCount: number; usageLimit: number | null },
  now = new Date(),
): DerivedOfferStatus {
  if (!offer.isActive) return "DISABLED";
  if (offer.usageLimit !== null && offer.usageCount >= offer.usageLimit) return "EXHAUSTED";
  if (now < offer.startsAt) return "SCHEDULED";
  if (now > offer.endsAt) return "EXPIRED";
  return "ACTIVE";
}

export async function getOfferById(id: number) {
  const row = await findOfferDetailById(id);
  if (!row) throw new NotFoundError("Offer");
  return {
    ...offerFields(row),
    category:
      row.categoryRefId !== null
        ? { id: row.categoryRefId, name: row.categoryRefName, slug: row.categoryRefSlug }
        : null,
    product:
      row.productRefId !== null
        ? { id: row.productRefId, name: row.productRefName, slug: row.productRefSlug }
        : null,
    _count: { redemptions: Number(row.redemptionCount) },
  };
}

export interface UpdateOfferInput {
  name?: string;
  startsAt?: Date;
  endsAt?: Date;
  usageLimit?: number | null;
  isActive?: boolean;
}

export async function updateOffer(id: number, input: UpdateOfferInput) {
  await updateOfferRow(id, input);
  const row = await findOfferDetailById(id);
  if (!row) throw new NotFoundError("Offer");
  return {
    ...offerFields(row),
    category:
      row.categoryRefId !== null
        ? { id: row.categoryRefId, name: row.categoryRefName }
        : null,
    product:
      row.productRefId !== null ? { id: row.productRefId, name: row.productRefName } : null,
    _count: { redemptions: Number(row.redemptionCount) },
    derivedStatus: deriveOfferStatus(row),
  };
}

export async function setOfferActive(id: number, isActive: boolean) {
  const existing = await findOfferRowById(id);
  if (!existing) throw new NotFoundError("Offer");
  return offerFields(await setOfferActiveRow(id, isActive));
}

export async function loadCandidateOffers(
  productIds: number[],
  categoryIds: number[],
  now = new Date(),
  tx: Tx | undefined = undefined,
) {
  const rows = await loadCandidateOfferRows(productIds, categoryIds, now, tx);
  return rows.map(toEvaluationOffer);
}

export async function findOfferByCode(code: string, tx: Tx | undefined = undefined) {
  const row = await findOfferRowByCode(code.trim().toUpperCase(), tx);
  return row ? toEvaluationOffer(row) : null;
}

export async function recordRedemptions(
  tx: Tx,
  orderId: number,
  redemptions: Array<{ offerId: number; discount: number }>,
): Promise<void> {
  for (const redemption of redemptions) {
    await insertOfferRedemption({ offerId: redemption.offerId, orderId, discount: redemption.discount }, tx);
    await incrementOfferUsage(redemption.offerId, 1, tx);
  }
}

export async function releaseRedemptions(tx: Tx, orderId: number): Promise<void> {
  const redemptions = await findRedemptionsByOrder(orderId, tx);
  for (const redemption of redemptions) {
    await incrementOfferUsage(redemption.offerId, -1, tx);
  }
  await deleteRedemptionsByOrder(orderId, tx);
}

export type { StockMovementType } from "../db/enums.js";