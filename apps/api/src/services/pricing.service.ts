import { multiplyMinor } from "@cibus/shared";
import type { AppliedOffer, OfferEvaluation, PricedLine } from "@cibus/shared";
import { evaluateOffers } from "@cibus/shared";
import type { Tx } from "../db/pool.js";
import { findProductsByIds } from "../db/repositories/catalog.repo.js";
import { findOfferByCode, loadCandidateOffers } from "./offer.service.js";

/**
 * Pricing service.
 *
 * The single place that turns requested product ids and quantities into money.
 * Both the storefront preview and the stored order route through here, so the
 * two can never disagree about what an order costs. No price or discount figure
 * from a client is ever trusted.
 */

export interface RequestedLine {
  productId: number;
  quantity: number;
}

export interface PricedLineResult extends PricedLine {
  name: string;
  slug: string;
  sku: string;
  unitLabel: string;
  lineSubtotal: number;
  lineDiscount: number;
  lineTotal: number;
  offerId: number | null;
  offerName: string | null;
  product: {
    id: number;
    stockQuantity: number;
    allowBackorder: boolean;
  };
}

export interface PricingResult {
  lines: PricedLineResult[];
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedOffers: AppliedOffer[];
  rejections: OfferEvaluation["rejections"];
  offerCode: string | null;
}

export interface PriceOptions {
  now?: Date;
  offerCode?: string | null;
  /**
   * Passed when pricing inside the checkout transaction, so the caller sees a
   * consistent snapshot of catalogue and offers.
   */
  tx?: Tx;
}

/**
 * Read catalogue rows and compute an authoritative price.
 *
 * Inactive or deleted products are treated as unavailable rather than being
 * silently dropped, so a cart holding one produces a clear error instead of a
 * mysteriously smaller total.
 */
export async function priceRequestedLines(
  requested: RequestedLine[],
  options: PriceOptions = {},
): Promise<PricingResult> {
  const now = options.now ?? new Date();
  const tx = options.tx;

  const productIds = [...new Set(requested.map((line) => line.productId))];

  const products = await findProductsByIds(productIds, tx);

  const byId = new Map(products.map((product) => [product.id, product]));
  const missing = productIds.filter((id) => !byId.get(id) || byId.get(id)!.deletedAt !== null);

  if (missing.length > 0) {
    return {
      lines: [],
      subtotal: 0,
      discountTotal: 0,
      total: 0,
      appliedOffers: [],
      rejections: [],
      offerCode: options.offerCode ?? null,
      unavailableProductIds: missing,
    } as PricingResult & { unavailableProductIds: number[] };
  }

  const inactive = products.filter((product) => !product.isActive).map((product) => product.id);
  if (inactive.length > 0) {
    return {
      lines: [],
      subtotal: 0,
      discountTotal: 0,
      total: 0,
      appliedOffers: [],
      rejections: [],
      offerCode: options.offerCode ?? null,
      unavailableProductIds: inactive,
    } as PricingResult & { unavailableProductIds: number[] };
  }

  const pricedLines: PricedLine[] = requested.map((line) => {
    const product = byId.get(line.productId)!;
    return {
      productId: product.id,
      categoryId: product.categoryId,
      unitPrice: product.price,
      quantity: line.quantity,
    };
  });

  const categoryIds = [...new Set(products.map((product) => product.categoryId))];
  const candidates = await loadCandidateOffers(productIds, categoryIds, now, tx);

  let selected = null;
  let resolvedCode: string | null = null;
  if (options.offerCode) {
    const found = await findOfferByCode(options.offerCode, tx);
    resolvedCode = options.offerCode;
    if (found) {
      selected = found;
    } else {
      return {
        lines: [],
        subtotal: 0,
        discountTotal: 0,
        total: 0,
        appliedOffers: [],
        rejections: [],
        offerCode: resolvedCode,
        invalidOfferCode: resolvedCode,
      } as PricingResult & { invalidOfferCode: string };
    }
  }

  const evaluation = evaluateOffers({ lines: pricedLines, offers: candidates, selectedOffer: selected, now });

  const lines: PricedLineResult[] = pricedLines.map((line) => {
    const product = byId.get(line.productId)!;
    const discount = evaluation.lineDiscounts.get(line.productId);
    const lineSubtotal = multiplyMinor(line.unitPrice, line.quantity);
    const lineDiscount = discount?.discount ?? 0;

    return {
      ...line,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      unitLabel: product.unitLabel,
      lineSubtotal,
      lineDiscount,
      lineTotal: lineSubtotal - lineDiscount,
      offerId: discount?.offerId ?? null,
      offerName: discount?.offerName ?? null,
      product: {
        id: product.id,
        stockQuantity: product.stockQuantity,
        allowBackorder: product.allowBackorder,
      },
    };
  });

  return {
    lines,
    subtotal: evaluation.subtotal,
    discountTotal: evaluation.subtotal - evaluation.total,
    total: evaluation.total,
    appliedOffers: evaluation.appliedOffers,
    rejections: evaluation.rejections,
    offerCode: resolvedCode,
  };
}

/** Read the cart and price it, without committing anything. */
export async function priceCartItems(requested: RequestedLine[], offerCode?: string | null) {
  return priceRequestedLines(requested, { offerCode: offerCode ?? null });
}