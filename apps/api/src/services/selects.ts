import type { OfferScope, OfferType } from "@cibus/shared";

/**
 * Pure projection and vocabulary helpers shared by the storefront and admin
 * panel. The Prisma-derived select shapes that used to live here were removed
 * with the raw-SQL migration; the row interfaces in `db/types.ts` now describe
 * what the queries return.
 */

/** The offer fields the shared evaluator needs. */
export interface EvaluationOfferSource {
  id: number;
  name: string;
  code: string | null;
  type: OfferType | string;
  value: number;
  scope: OfferScope | string;
  categoryId: number | null;
  productId: number | null;
  minOrderAmount: number;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Convert a database offer row into the pure-evaluation shape used by
 * packages/shared. Kept in one place so the mapping cannot drift between routes.
 */
export function toEvaluationOffer(row: EvaluationOfferSource) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type as OfferType,
    value: row.value,
    scope: row.scope as OfferScope,
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

export function availabilityOf(product: {
  stockQuantity: number;
  allowBackorder: boolean;
  isActive: boolean;
}): "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNAVAILABLE" {
  if (!product.isActive) return "UNAVAILABLE";
  if (product.stockQuantity > 0) {
    return product.stockQuantity <= 5 ? "LOW_STOCK" : "IN_STOCK";
  }
  return product.allowBackorder ? "IN_STOCK" : "OUT_OF_STOCK";
}

export function isPurchasable(product: {
  stockQuantity: number;
  allowBackorder: boolean;
  isActive: boolean;
}): boolean {
  return product.isActive && (product.stockQuantity > 0 || product.allowBackorder);
}