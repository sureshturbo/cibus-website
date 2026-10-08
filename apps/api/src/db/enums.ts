/**
 * Database-layer domain vocabulary.
 *
 * The literals are defined once in @cibus/shared so the API, storefront and admin
 * cannot drift. Re-exported here so data-access code imports its vocabulary from
 * the db layer instead of reaching into the shared package directly.
 */
export {
  ORDER_STATUSES,
  INVOICE_STATUSES,
  STOCK_MOVEMENT_TYPES,
  STOCK_REFERENCE_TYPES,
  OFFER_TYPES,
  OFFER_SCOPES,
  FULFILMENT_METHODS,
  ENQUIRY_STATUSES,
  PAYMENT_STATUSES,
} from "@cibus/shared";

export type {
  OrderStatus,
  InvoiceStatus,
  StockMovementType,
  StockReferenceType,
  OfferType,
  OfferScope,
  FulfilmentMethod,
  EnquiryStatus,
  PaymentStatus,
} from "@cibus/shared";