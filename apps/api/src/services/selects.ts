import type { OfferScope, OfferType, Prisma } from "@prisma/client";

/** Reusable select shapes, so the storefront never receives a field it must not see. */

export const publicProductSelect = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  shortDescription: true,
  description: true,
  unitLabel: true,
  price: true,
  compareAtPrice: true,
  stockQuantity: true,
  lowStockThreshold: true,
  allowBackorder: true,
  isActive: true,
  isFeatured: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type PublicProduct = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;

export const adminProductSelect = {
  ...publicProductSelect,
  categoryId: true,
  deletedAt: true,
  category: { select: { id: true, name: true, slug: true, parentId: true } },
  images: {
    select: { id: true, url: true, altText: true, isPrimary: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
  },
} satisfies Prisma.ProductSelect;

export type AdminProduct = Prisma.ProductGetPayload<{ select: typeof adminProductSelect }>;

export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  description: true,
  imageUrl: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

export const offerSelect = {
  id: true,
  name: true,
  code: true,
  type: true,
  value: true,
  scope: true,
  categoryId: true,
  productId: true,
  minOrderAmount: true,
  startsAt: true,
  endsAt: true,
  usageLimit: true,
  usageCount: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OfferSelect;

export type OfferRecordRow = Prisma.OfferGetPayload<{ select: typeof offerSelect }>;

/**
 * Convert a database offer row into the pure-evaluation shape used by
 * packages/shared. Kept in one place so the mapping cannot drift between routes.
 */
export function toEvaluationOffer(row: OfferRecordRow) {
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