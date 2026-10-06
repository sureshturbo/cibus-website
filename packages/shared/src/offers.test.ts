import { describe, expect, it } from "vitest";
import {
  basisPointsToPercent,
  evaluateOffers,
  percentToBasisPoints,
  rawDiscountFor,
  BASIS_POINTS_DIVISOR,
  BASIS_POINTS_PER_PERCENT,
  MAX_PERCENTAGE_BPS,
  type OfferRecord,
} from "./offers.js";

/** Build an offer with sensible defaults so each test states only what matters. */
function offer(overrides: Partial<OfferRecord> = {}): OfferRecord {
  const now = new Date("2026-06-01T00:00:00.000Z");
  return {
    id: 1,
    name: "Test offer",
    code: null,
    type: "PERCENTAGE",
    value: 1000,
    scope: "ALL_PRODUCTS",
    categoryId: null,
    productId: null,
    minOrderAmount: 0,
    usageLimit: null,
    usageCount: 0,
    isActive: true,
    startsAt: new Date(now.getTime() - 86_400_000),
    endsAt: new Date(now.getTime() + 86_400_000),
    ...overrides,
  };
}

const NOW = new Date("2026-06-01T00:00:00.000Z");

describe("basis point conversion", () => {
  it("converts percent to basis points", () => {
    expect(percentToBasisPoints(5)).toBe(500);
    expect(percentToBasisPoints(12.5)).toBe(1250);
    expect(percentToBasisPoints(100)).toBe(10_000);
  });

  it("round-trips a percent figure", () => {
    expect(basisPointsToPercent(percentToBasisPoints(7.25))).toBe(7.25);
  });

  it("uses a divisor an order of magnitude larger than the percent constant", () => {
    // These two being equal is the bug that shipped: 100 bp would be treated as
    // 1%, so every discount would be 100x too large.
    expect(BASIS_POINTS_PER_PERCENT).toBe(100);
    expect(BASIS_POINTS_DIVISOR).toBe(10_000);
    expect(BASIS_POINTS_DIVISOR).toBe(BASIS_POINTS_PER_PERCENT * 100);
  });

  it("caps the stored percentage at 100%", () => {
    expect(MAX_PERCENTAGE_BPS).toBe(percentToBasisPoints(100));
  });
});

describe("rawDiscountFor", () => {
  it("discounts a percentage of the base", () => {
    // 5% of 136.00 = 6.80
    expect(rawDiscountFor(offer({ type: "PERCENTAGE", value: 500 }), 13_600)).toBe(680);
  });

  it("discounts 10% of 249.00 exactly", () => {
    expect(rawDiscountFor(offer({ type: "PERCENTAGE", value: 1000 }), 24_900)).toBe(2_490);
  });

  it("discounts a fixed amount as paise, not percent", () => {
    expect(rawDiscountFor(offer({ type: "FIXED_AMOUNT", value: 10_000 }), 13_600)).toBe(10_000);
  });

  it("treats 100% as the whole base, not more", () => {
    expect(rawDiscountFor(offer({ type: "PERCENTAGE", value: 10_000 }), 13_600)).toBe(13_600);
  });

  it("returns zero for an unknown type rather than guessing", () => {
    expect(
      rawDiscountFor(offer({ type: "BOGUS" as OfferRecord["type"] }), 13_600),
    ).toBe(0);
  });

  it("never exceeds the base for any percentage within range", () => {
    for (let bps = 0; bps <= MAX_PERCENTAGE_BPS; bps += 137) {
      const discount = rawDiscountFor(offer({ type: "PERCENTAGE", value: bps }), 13_600);
      expect(discount).toBeLessThanOrEqual(13_600);
    }
  });
});

describe("evaluateOffers", () => {
  const line = { productId: 1, categoryId: 10, unitPrice: 6_800, quantity: 2 };

  it("applies a selected code as an order-level discount", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [],
      selectedOffer: offer({ type: "PERCENTAGE", value: 1000, code: "WELCOME10" }),
      now: NOW,
    });

    expect(result.subtotal).toBe(13_600);
    expect(result.orderDiscount).toBe(1_360);
    expect(result.total).toBe(12_240);
  });

  it("leaves the total intact when no offer applies", () => {
    const result = evaluateOffers({ lines: [line], offers: [], now: NOW });

    expect(result.subtotal).toBe(13_600);
    expect(result.orderDiscount).toBe(0);
    expect(result.lineDiscounts.size).toBe(0);
    expect(result.total).toBe(13_600);
  });

  it("does not apply the selected offer twice to the same line", () => {
    const selected = offer({ id: 1, type: "PERCENTAGE", value: 1000, code: "TEN" });
    const lineOffer = offer({ id: 2, type: "PERCENTAGE", value: 5000 });

    const result = evaluateOffers({
      lines: [line],
      offers: [selected, lineOffer],
      selectedOffer: selected,
      now: NOW,
    });

    expect(result.orderDiscount).toBe(1_360);

    // The line discount comes from the other offer, never from the selected one.
    // A selected offer is an order-level discount; reusing it per line would
    // count the same offer twice against the budget.
    const lineDiscount = result.lineDiscounts.get(1);
    expect(lineDiscount?.offerId).toBe(2);
    expect(lineDiscount?.discount).toBe(6_800);
    expect(result.total).toBe(13_600 - 1_360 - 6_800);
  });

  it("picks the largest eligible automatic offer per line", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [
        offer({ id: 1, type: "PERCENTAGE", value: 500 }),
        offer({ id: 2, type: "PERCENTAGE", value: 1500 }),
        offer({ id: 3, type: "PERCENTAGE", value: 2500 }),
      ],
      now: NOW,
    });

    // 25% of 136.00 = 34.00, beating the 15% and 5% candidates.
    expect(result.lineDiscounts.get(1)?.offerId).toBe(3);
    expect(result.lineDiscounts.get(1)?.discount).toBe(3_400);
  });

  it("breaks a discount tie on the lower offer id so results are deterministic", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [
        offer({ id: 7, type: "PERCENTAGE", value: 1000 }),
        offer({ id: 4, type: "PERCENTAGE", value: 1000 }),
      ],
      now: NOW,
    });

    expect(result.lineDiscounts.get(1)?.offerId).toBe(4);
  });

  it("does not let per-line discounts exceed the subtotal across lines", () => {
    const lines = [
      { productId: 1, categoryId: 10, unitPrice: 6_800, quantity: 2 },
      { productId: 2, categoryId: 10, unitPrice: 6_800, quantity: 2 },
      { productId: 3, categoryId: 10, unitPrice: 6_800, quantity: 2 },
    ];

    const result = evaluateOffers({
      lines,
      // Each line would be discounted 50%, which across three lines is 150% of
      // the subtotal. The total must never go negative.
      offers: [offer({ type: "PERCENTAGE", value: 5_000 })],
      now: NOW,
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.subtotal - result.total).toBeLessThanOrEqual(result.subtotal);
  });

  it("rejects a code that does not meet its minimum order value", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [],
      selectedOffer: offer({ type: "PERCENTAGE", value: 1000, minOrderAmount: 50_000 }),
      now: NOW,
    });

    expect(result.orderDiscount).toBe(0);
    expect(result.total).toBe(13_600);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]?.reason).toMatch(/minimum order value/i);
  });

  it("skips an offer that has not started yet", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [offer({ type: "PERCENTAGE", value: 1000, startsAt: new Date("2026-07-01") })],
      now: NOW,
    });

    expect(result.lineDiscounts.size).toBe(0);
  });

  it("skips an offer that has expired", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [offer({ type: "PERCENTAGE", value: 1000, endsAt: new Date("2026-05-01") })],
      now: NOW,
    });

    expect(result.lineDiscounts.size).toBe(0);
  });

  it("skips an offer that has reached its usage limit", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [offer({ type: "PERCENTAGE", value: 1000, usageLimit: 5, usageCount: 5 })],
      now: NOW,
    });

    expect(result.lineDiscounts.size).toBe(0);
  });

  it("skips an offer scoped to a different category", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [offer({ type: "PERCENTAGE", value: 1000, scope: "CATEGORY", categoryId: 99 })],
      now: NOW,
    });

    expect(result.lineDiscounts.size).toBe(0);
  });

  it("applies an offer scoped to a matching category", () => {
    const result = evaluateOffers({
      lines: [line],
      offers: [offer({ type: "PERCENTAGE", value: 500, scope: "CATEGORY", categoryId: 10 })],
      now: NOW,
    });

    expect(result.lineDiscounts.get(1)?.discount).toBe(680);
  });

  it("always returns a total that reconciles with the subtotal", () => {
    const result = evaluateOffers({
      lines: [line, { productId: 2, categoryId: 11, unitPrice: 17_500, quantity: 1 }],
      offers: [
        offer({ id: 1, type: "PERCENTAGE", value: 1250, scope: "ALL_PRODUCTS" }),
        offer({ id: 2, type: "FIXED_AMOUNT", value: 5_000, scope: "CATEGORY", categoryId: 11 }),
      ],
      now: NOW,
    });

    const discountTotal =
      result.orderDiscount +
      [...result.lineDiscounts.values()].reduce((sum, d) => sum + d.discount, 0);

    expect(result.subtotal - discountTotal).toBe(result.total);
  });
});