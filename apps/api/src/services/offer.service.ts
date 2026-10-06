import { OfferScope, OfferType, Prisma, StockMovementType } from "@prisma/client";
import { paginate, type Paginated } from "@cibus/shared";
import { NotFoundError, ValidationError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { percentToBasisPoints, type OfferScope as SharedScope, type OfferType as SharedType } from "@cibus/shared";
import { toMinor, assertStorableMinor } from "@cibus/shared";
import { toEvaluationOffer } from "./selects.js";

/**
 * Offer creation, listing and evaluation.
 *
 * All arithmetic delegates to the pure evaluator in @cibus/shared so the rules
 * are unit-testable without a database, and so checkout and the storefront
 * preview can never disagree about what an order costs.
 */

type Tx = Prisma.TransactionClient;

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

export async function createOffer(input: CreateOfferInput, tx: Tx = prisma) {
  const code = input.code?.trim().toUpperCase() || null;

  if (code) {
    const clash = await tx.offer.findUnique({ where: { code }, select: { id: true } });
    if (clash) throw new ValidationError("That offer code is already in use");
  }

  if (input.scope === "CATEGORY" && input.categoryId) {
    const category = await tx.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!category) throw new ValidationError("The selected category does not exist");
  }
  if (input.scope === "PRODUCT" && input.productId) {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, deletedAt: true },
    });
    if (!product || product.deletedAt) throw new ValidationError("The selected product does not exist");
  }

  return tx.offer.create({
    data: {
      name: input.name,
      code,
      type: input.type as OfferType,
      value: encodeOfferValue(input.type, input.value),
      scope: input.scope as OfferScope,
      categoryId: input.scope === "CATEGORY" ? (input.categoryId ?? null) : null,
      productId: input.scope === "PRODUCT" ? (input.productId ?? null) : null,
      minOrderAmount: input.minOrderAmount ? assertStorableMinor(toMinor(input.minOrderAmount), "Minimum order amount") : 0,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      usageLimit: input.usageLimit ?? null,
      isActive: input.isActive,
    },
  });
}

export interface ListOffersQuery {
  page: number;
  pageSize: number;
  status?: "all" | "active" | "scheduled" | "expired";
  search?: string;
}

export async function listOffers(query: ListOffersQuery): Promise<Paginated<unknown>> {
  const where: Prisma.OfferWhereInput = {};
  const now = new Date();

  if (query.status === "active") {
    where.isActive = true;
    where.startsAt = { lte: now };
    where.endsAt = { gte: now };
  } else if (query.status === "scheduled") {
    where.startsAt = { gt: now };
  } else if (query.status === "expired") {
    where.endsAt = { lt: now };
  }

  if (query.search) {
    where.OR = [{ name: { contains: query.search } }, { code: { contains: query.search.toUpperCase() } }];
  }

  const [total, rows] = await Promise.all([
    prisma.offer.count({ where }),
    prisma.offer.findMany({
      where,
      orderBy: [{ startsAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
        _count: { select: { redemptions: true } },
      },
    }),
  ]);

  const items = rows.map((row) => ({
    ...row,
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
  const offer = await prisma.offer.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      product: { select: { id: true, name: true, slug: true } },
      _count: { select: { redemptions: true } },
    },
  });
  if (!offer) throw new NotFoundError("Offer");
  return offer;
}

export async function setOfferActive(id: number, isActive: boolean) {
  const existing = await prisma.offer.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Offer");
  return prisma.offer.update({ where: { id }, data: { isActive } });
}

/**
 * Load every offer that could apply to the given product ids, evaluated in
 * memory. Loading by product set keeps the query bounded regardless of how many
 * offers the business defines.
 */
export async function loadCandidateOffers(productIds: number[], categoryIds: number[], now = new Date()) {
  const candidates = await prisma.offer.findMany({
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
  return candidates.map(toEvaluationOffer);
}

export async function findOfferByCode(code: string) {
  const row = await prisma.offer.findUnique({ where: { code: code.trim().toUpperCase() } });
  return row ? toEvaluationOffer(row) : null;
}

/**
 * Record an offer's use against an order. Runs inside the order transaction so
 * a rollback also rolls back the usage count.
 */
export async function recordRedemptions(
  tx: Tx,
  orderId: number,
  redemptions: Array<{ offerId: number; discount: number }>,
): Promise<void> {
  if (redemptions.length === 0) return;

  for (const redemption of redemptions) {
    await tx.offerRedemption.create({
      data: { offerId: redemption.offerId, orderId, discount: redemption.discount },
    });
    await tx.offer.update({
      where: { id: redemption.offerId },
      data: { usageCount: { increment: 1 } },
    });
  }
}

/** Undo redemptions when an order is cancelled, so the budget is restored. */
export async function releaseRedemptions(tx: Tx, orderId: number): Promise<void> {
  const redemptions = await tx.offerRedemption.findMany({ where: { orderId } });
  for (const redemption of redemptions) {
    await tx.offer.update({
      where: { id: redemption.offerId },
      data: { usageCount: { decrement: 1 } },
    });
  }
  await tx.offerRedemption.deleteMany({ where: { orderId } });
}

export { StockMovementType };