import type { RowDataPacket } from "mysql2/promise";
import type {
  EnquiryStatus,
  FulfilmentMethod,
  InvoiceStatus,
  OfferScope,
  OfferType,
  OrderStatus,
  PaymentStatus,
  StockMovementType,
  StockReferenceType,
} from "./enums.js";

/**
 * Raw row shapes as they come back from mysql2.
 *
 * These mirror the column set in prisma/schema.prisma, but with camelCase keys:
 * every SELECT aliases `snake_case` columns to camelCase so a row matches the
 * object Prisma used to return. They are the input to the DTO mappers; routes
 * never serialise a raw row directly.
 *
 * Booleans are real booleans (the pool's typeCast coerces TINYINT(1)) and dates
 * are Date objects (the pool reads DATETIME as UTC).
 */

export interface AdminRow extends RowDataPacket {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerRow extends RowDataPacket {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddressRow extends RowDataPacket {
  id: number;
  customerId: number;
  label: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  landmark: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshSessionRow extends RowDataPacket {
  id: number;
  customerId: number | null;
  adminId: number | null;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CategoryRow extends RowDataPacket {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRow extends RowDataPacket {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string;
  description: string;
  unitLabel: string;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  isActive: boolean;
  isFeatured: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductImageRow extends RowDataPacket {
  id: number;
  productId: number;
  url: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface StockMovementRow extends RowDataPacket {
  id: number;
  productId: number;
  type: StockMovementType;
  quantityChange: number;
  balanceAfter: number;
  referenceType: StockReferenceType;
  referenceId: string | null;
  note: string;
  createdById: number | null;
  createdAt: Date;
}

export interface OfferRow extends RowDataPacket {
  id: number;
  name: string;
  code: string | null;
  type: OfferType;
  value: number;
  scope: OfferScope;
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
}

export interface OfferRedemptionRow extends RowDataPacket {
  id: number;
  offerId: number;
  orderId: number;
  discount: number;
  createdAt: Date;
}

export interface CartRow extends RowDataPacket {
  id: number;
  token: string | null;
  customerId: number | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CartItemRow extends RowDataPacket {
  id: number;
  cartId: number;
  productId: number;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderRow extends RowDataPacket {
  id: number;
  orderNumber: string;
  customerId: number | null;
  status: OrderStatus;
  fulfilmentMethod: FulfilmentMethod;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressLandmark: string | null;
  subtotal: number;
  discountTotal: number;
  total: number;
  deliveryNotes: string;
  stockCommittedAt: Date | null;
  confirmedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemRow extends RowDataPacket {
  id: number;
  orderId: number;
  productId: number | null;
  productName: string;
  productSlug: string;
  sku: string;
  unitLabel: string;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  lineTotal: number;
  offerId: number | null;
  offerName: string | null;
}

export interface OrderStatusHistoryRow extends RowDataPacket {
  id: number;
  orderId: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string;
  changedBy: string;
  createdAt: Date;
}

export interface PaymentRow extends RowDataPacket {
  id: number;
  orderId: number;
  amount: number;
  status: PaymentStatus;
  provider: string | null;
  providerReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceRow extends RowDataPacket {
  id: number;
  invoiceNumber: string;
  financialYear: string;
  orderId: number;
  status: InvoiceStatus;
  issuerName: string;
  issuerAddress: string;
  issuerEmail: string;
  issuerPhone: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  issuedAt: Date;
  dueAt: Date | null;
  pdfPath: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SequenceCounterRow extends RowDataPacket {
  id: number;
  scope: string;
  period: string;
  lastValue: number;
  prefix: string;
  updatedAt: Date;
}

export interface PartnerEnquiryRow extends RowDataPacket {
  id: number;
  name: string;
  businessName: string;
  email: string;
  phone: string;
  message: string;
  status: EnquiryStatus;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdempotencyKeyRow extends RowDataPacket {
  id: number;
  key: string;
  scope: string;
  orderId: number | null;
  responseHash: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}