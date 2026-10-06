import {
  evaluateOffers,
  multiplyMinor,
  type AppliedOffer,
  type OfferEvaluation,
  type PricedLine,
} from "@cibus/shared";
import { prisma } from "../lib/prisma.js";
import { findOfferByCode, loadCandidateOffers } from "./offer.service.js";

/**
 * Pricing.
 *
 * One module owns the rule that the server decides what an order costs. The
 * cart preview, the checkout summary and the order itself all call through here,
 * so the figure a customer is shown and the figure that gets stored come from
 * identical arithmetic.
 *
 * No price ever arrives from the client. Only product ids and quantities do.
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
  tx?: Parameters<typeof loadCandidateOffers>[2] extends never ? never : typeof prisma;
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
  const client = options.tx ?? prisma;

  const productIds = [...new Set(requested.map((line) => line.productId))];

  const products = await client.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      categoryId: true,
      name: true,
      slug: true,
      sku: true,
      unitLabel: true,
      price: true,
      stockQuantity: true,
      allowBackorder: true,
      isActive: true,
      deletedAt: true,
    },
  });

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
  const candidates = await loadCandidateOffers(productIds, categoryIds, now);

  let selected = null;
  let resolvedCode: string | null = null;
  if (options.offerCode) {
    const found = await findOfferByCode(options.offerCode);
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