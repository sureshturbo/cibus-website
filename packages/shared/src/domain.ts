/**
 * Shared domain vocabulary.
 *
 * These literals are the single source of truth for state machines. The API
 * persists them as MySQL enums; the clients compare against the same values,
 * so a rename must happen here and in the schema migration together.
 */

/* ------------------------------- orders ---------------------------------- */

export const ORDER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The only legal order status transitions. Any change outside this map is
 * rejected by the API rather than silently applied.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: ["REFUNDED"],
  REFUNDED: [],
};

/** Statuses that consume stock. Stock is released again on cancellation. */
export const STOCK_CONSUMING_STATUSES: readonly OrderStatus[] = [
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "OUT_FOR_DELIVERY",
];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

export const FULFILMENT_METHODS = ["DELIVERY", "PICKUP"] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

/* ------------------------------- invoices -------------------------------- */

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/* -------------------------------- stock ---------------------------------- */

export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE",
  "SALE",
  "ADJUSTMENT",
  "RETURN",
  "DAMAGE",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_REFERENCE_TYPES = ["ORDER", "MANUAL", "SUPPLIER"] as const;
export type StockReferenceType = (typeof STOCK_REFERENCE_TYPES)[number];

/* -------------------------------- offers --------------------------------- */

export const OFFER_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_SCOPES = ["ALL_PRODUCTS", "CATEGORY", "PRODUCT"] as const;
export type OfferScope = (typeof OFFER_SCOPES)[number];

/* -------------------------------- partners -------------------------------- */

export const ENQUIRY_STATUSES = ["NEW", "CONTACTED", "CLOSED"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/* ------------------------------- payments -------------------------------- */

/**
 * Placeholder only. Payment processing is out of scope for this build; the
 * table shape exists so the order model does not need restructuring when a
 * gateway is introduced later.
 */
export const PAYMENT_STATUSES = [
  "PENDING",
  "INITIATED",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/* ------------------------------ pagination ------------------------------- */

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 100;