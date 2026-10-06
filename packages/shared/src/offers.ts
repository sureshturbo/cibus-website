import { multiplyMinor, type Minor } from "./money.js";
import type { OfferScope, OfferType } from "./domain.js";

/**
 * Pure offer resolution.
 *
 * This module is intentionally free of database access so it can be exhaustively
 * unit tested. The API layer loads candidate offers, then delegates all arithmetic
 * here. Nothing in this file may trust a client-supplied price.
 */

/**
 * Storage convention for `offers.value` (integer, never float):
 *  - PERCENTAGE   -> basis points. 1250 means 12.50%.
 *  - FIXED_AMOUNT -> integer paise. 25000 means 250.00.
 */
/**
 * 1 percent = 100 basis points. Use this to CONVERT a percent figure to storage.
 */
export const BASIS_POINTS_PER_PERCENT = 100;

/**
 * Divisor for COMPUTING a discount: `base * bps / BASIS_POINTS_DIVISOR`.
 *
 * This is deliberately a separate constant from BASIS_POINTS_PER_PERCENT. The two
 * numbers differ by a factor of 100, and using the wrong one silently inflates
 * every percentage discount: dividing by 100 instead of 10 000 turned a 5% offer
 * into a 100% discount that zeroed the order total. Do not collapse them.
 */
export const BASIS_POINTS_DIVISOR = 10_000;

/** No percentage offer may exceed 100%. Guards a malformed stored value. */
export const MAX_PERCENTAGE_BPS = 100 * BASIS_POINTS_PER_PERCENT;

export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * BASIS_POINTS_PER_PERCENT);
}

export function basisPointsToPercent(basisPoints: number): number {
  return basisPoints / BASIS_POINTS_PER_PERCENT;
}

export interface OfferRecord {
  id: number;
  name: string;
  code: string | null;
  type: OfferType;
  /** Basis points for PERCENTAGE, integer paise for FIXED_AMOUNT. */
  value: number;
  scope: OfferScope;
  categoryId: number | null;
  productId: number | null;
  minOrderAmount: Minor;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date;
}

export interface PricedLine {
  productId: number;
  categoryId: number;
  unitPrice: Minor;
  quantity: number;
}

export interface LineDiscount {
  productId: number;
  discount: Minor;
  offerId: number;
  offerName: string;
}

export interface AppliedOffer {
  offerId: number;
  offerName: string;
  code: string | null;
  discount: Minor;
}

export interface OfferEvaluation {
  subtotal: Minor;
  lineDiscounts: Map<number, LineDiscount>;
  orderDiscount: Minor;
  appliedOffers: AppliedOffer[];
  /** Rule violations encountered, so the API can explain a rejected code. */
  rejections: Array<{ offerId: number; offerName: string; reason: string }>;
  total: Minor;
}

/** Cap a discount so it can never exceed what is actually being discounted. */
function clamp(discount: Minor, ceiling: Minor): Minor {
  if (discount <= 0) return 0;
  return discount > ceiling ? ceiling : discount;
}

/** Raw discount this offer yields against a base amount, before clamping. */
export function rawDiscountFor(offer: OfferRecord, base: Minor): Minor {
  switch (offer.type) {
    case "PERCENTAGE": {
      // Clamp the stored value too, not just the result: a value above 100% must
      // never be able to consume more than the base even if clamp() is bypassed.
      const bps = Math.min(Math.max(offer.value, 0), MAX_PERCENTAGE_BPS);
      return Math.floor((base * bps) / BASIS_POINTS_DIVISOR);
    }
    case "FIXED_AMOUNT":
      return offer.value;
    default:
      return 0;
  }
}

export function isOfferLive(offer: OfferRecord, now: Date): boolean {
  return now >= offer.startsAt && now <= offer.endsAt;
}

export function isOfferExhausted(offer: OfferRecord): boolean {
  return offer.usageLimit !== null && offer.usageCount >= offer.usageLimit;
}

export function offerAppliesToLine(offer: OfferRecord, line: PricedLine): boolean {
  switch (offer.scope) {
    case "ALL_PRODUCTS":
      return true;
    case "CATEGORY":
      return offer.categoryId !== null && offer.categoryId === line.categoryId;
    case "PRODUCT":
      return offer.productId !== null && offer.productId === line.productId;
    default:
      return false;
  }
}

export function offerRejectionReason(
  offer: OfferRecord,
  orderSubtotal: Minor,
  now: Date,
): string | null {
  if (!offer.isActive) return "This offer is no longer active.";
  if (now < offer.startsAt) return "This offer has not started yet.";
  if (now > offer.endsAt) return "This offer has expired.";
  if (isOfferExhausted(offer)) return "This offer has reached its usage limit.";
  if (offer.minOrderAmount > 0 && orderSubtotal < offer.minOrderAmount) {
    return `This offer requires a minimum order value of ${(offer.minOrderAmount / 100).toFixed(2)}.`;
  }
  return null;
}

export interface EvaluateOptions {
  lines: PricedLine[];
  /** Every offer the admin has defined; evaluation picks the best eligible ones. */
  offers: OfferRecord[];
  now?: Date;
  /** Offer the customer explicitly selected by code. Takes precedence. */
  selectedOffer?: OfferRecord | null;
}

/**
 * Resolve discounts across an order.
 *
 * Precedence:
 *  1. An order-level offer explicitly selected by code (customer intent wins).
 *  2. Otherwise the single best eligible automatic offer per product.
 *
 * Automatic offers never stack on the same line, and the order-level discount
 * is subtracted first so automatic discounts can never exceed the order total.
 */
export function evaluateOffers(options: EvaluateOptions): OfferEvaluation {
  const { lines, offers, selectedOffer = null } = options;
  const now = options.now ?? new Date();

  const subtotal = lines.reduce(
    (total, line) => total + multiplyMinor(line.unitPrice, line.quantity),
    0,
  );
  const lineDiscounts = new Map<number, LineDiscount>();
  const appliedOffers: AppliedOffer[] = [];
  const rejections: Array<{ offerId: number; offerName: string; reason: string }> = [];

  let remainingBudget = subtotal;

  /* --- 1. explicitly selected offer, applied to the whole order ---------- */
  let orderDiscount: Minor = 0;
  if (selectedOffer) {
    const reason = offerRejectionReason(selectedOffer, subtotal, now);
    if (reason) {
      rejections.push({ offerId: selectedOffer.id, offerName: selectedOffer.name, reason });
    } else {
      orderDiscount = clamp(rawDiscountFor(selectedOffer, subtotal), subtotal);
      if (orderDiscount > 0) {
        remainingBudget -= orderDiscount;
        appliedOffers.push({
          offerId: selectedOffer.id,
          offerName: selectedOffer.name,
          code: selectedOffer.code,
          discount: orderDiscount,
        });
      }
    }
  }

  /* --- 2. best automatic offer per line --------------------------------- */
  for (const line of lines) {
    if (remainingBudget <= 0) break;

    const lineTotal = multiplyMinor(line.unitPrice, line.quantity);
    let best: { offer: OfferRecord; discount: Minor } | null = null;

    for (const offer of offers) {
      if (offer.id === selectedOffer?.id) continue;
      if (!offer.isActive) continue;
      if (!isOfferLive(offer, now)) continue;
      if (isOfferExhausted(offer)) continue;
      if (offer.minOrderAmount > 0 && subtotal < offer.minOrderAmount) continue;
      if (!offerAppliesToLine(offer, line)) continue;

      const discount = clamp(rawDiscountFor(offer, lineTotal), lineTotal);
      if (discount <= 0) continue;

      // Larger discount wins; ties break on the lower id so results are deterministic.
      if (!best || discount > best.discount || (discount === best.discount && offer.id < best.offer.id)) {
        best = { offer, discount };
      }
    }

    if (!best) continue;

    const capped = clamp(best.discount, remainingBudget);
    if (capped <= 0) continue;

    lineDiscounts.set(line.productId, {
      productId: line.productId,
      discount: capped,
      offerId: best.offer.id,
      offerName: best.offer.name,
    });
    appliedOffers.push({
      offerId: best.offer.id,
      offerName: best.offer.name,
      code: best.offer.code,
      discount: capped,
    });
    remainingBudget -= capped;
  }

  const totalDiscount =
    orderDiscount + Array.from(lineDiscounts.values()).reduce((t, d) => t + d.discount, 0);

  return {
    subtotal,
    lineDiscounts,
    orderDiscount,
    appliedOffers,
    rejections,
    total: subtotal - totalDiscount,
  };
}