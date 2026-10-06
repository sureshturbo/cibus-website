export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  productCount: number;
}

export interface ProductImage {
  id: number;
  url: string;
  altText: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

/** Card-shaped product, as returned by the list and search routes. */
export interface Product {
  id: number;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  /** Summarised server-side, so a long body never travels in a list response. */
  description: string | null;
  unitLabel: string;
  /** Minor units (paise). Never divide by 100 without using fromMinor. */
  price: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  inStock: boolean;
  stockQuantity: number;
  isFeatured: boolean;
  category: { id: number; name: string; slug: string } | null;
  images: ProductImage[];
  primaryImage: ProductImage | null;
}

/**
 * Same-category suggestions from the detail route. A deliberately small shape:
 * a related rail only shows a title, a price and a thumbnail.
 */
export interface RelatedProduct {
  id: number;
  name: string;
  slug: string;
  price: number;
  compareAtPrice: number | null;
  stockQuantity: number;
  unitLabel: string;
  images: ProductImage[];
}

/**
 * The detail route returns the full row plus a server-decided maximum quantity
 * and same-category suggestions, so it is not the list shape.
 */
export interface ProductDetail extends Omit<Product, "primaryImage"> {
  categoryId: number;
  allowBackorder: boolean;
  lowStockThreshold: number;
  maxQuantity: number;
  related: RelatedProduct[];
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SiteConfig {
  company: {
    name: string;
    tagline: string;
    description: string;
    email: string;
    phone: string;
    address: string;
    businessHours: string;
    socialLinks: Array<{ platform: string; url: string }>;
  };
  currency: string;
  paymentEnabled: boolean;
  paymentNotice: string;
  offerCodesEnabled: boolean;
  guestCheckoutEnabled: boolean;
  maxQuantityPerLine: number;
}

export interface HomePayload {
  company: SiteConfig["company"];
  hero: {
    headline: string;
    highlight: string;
    subheadline: string;
    primaryCta: string;
    secondaryCta: string;
  };
  highlights: { title: string; description: string; icon: string }[];
  categoriesBlurb: string;
  featuredProducts: Product[];
  newestProducts: Product[];
  pages: { slug: string; title: string; subtitle: string | null }[];
}

export interface StaticPage {
  slug: string;
  title: string;
  subtitle?: string;
  body?: string;
  meta: Record<string, unknown>;
}

export interface CartLine {
  productId: number;
  name: string;
  slug: string;
  sku: string;
  unitLabel: string;
  unitPrice: number;
  compareAtPrice: number | null;
  lineTotal: number;
  quantity: number;
  stockQuantity: number;
  purchasable: boolean;
  issue: string | null;
  image: { url: string; altText: string } | null;
  category: { name: string; slug: string } | null;
}

export interface Cart {
  items: CartLine[];
  itemCount: number;
  totalQuantity: number;
  subtotal: number;
  savings: number;
  hasUnavailableItems: boolean;
  allPurchasable: boolean;
  issues: string[];
}

/* ------------------------------- customers -------------------------------- */

export interface Customer {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface Address extends AddressInput {
  id: number;
  label: string;
  isDefault: boolean;
}

export interface AddressBookEntryInput extends AddressInput {
  label: string;
  isDefault: boolean;
}

/* -------------------------------- checkout ------------------------------- */

export interface AddressInput {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  landmark?: string;
}

export type FulfilmentMethod = "DELIVERY" | "PICKUP";

export interface CheckoutInput {
  email: string;
  fullName: string;
  phone: string;
  fulfilmentMethod: FulfilmentMethod;
  address: AddressInput;
  deliveryNotes?: string;
  offerCode?: string;
  /** Client-generated, so a double submit cannot create two orders. */
  idempotencyKey: string;
}

export interface AppliedOffer {
  offerId: number;
  offerName: string;
  code: string | null;
  discount: number;
}

export interface RejectedOffer {
  offerId: number;
  offerName: string;
  reason: string;
}

/**
 * Server-computed money. The client never derives a total from cart lines, so
 * every figure here comes from `pricing.service.ts` via `previewCart`.
 */
export interface CartPreview extends Cart {
  discountTotal: number;
  estimatedTotal: number;
  appliedOffers: AppliedOffer[];
  offerRejections: RejectedOffer[];
}

/* --------------------------------- orders --------------------------------- */

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PACKING"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export interface OrderItem {
  id: number;
  productId: number | null;
  productName: string;
  productSlug: string;
  sku: string;
  unitLabel: string;
  unitPrice: number;
  quantity: number;
  lineDiscount: number;
  lineTotal: number;
  offerName: string | null;
}

export interface OrderInvoice {
  id: number;
  invoiceNumber: string;
  status: string;
  total: number;
  issuedAt: string | null;
}

export interface OrderSummary {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  fulfilmentMethod: FulfilmentMethod;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  addressCity: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  createdAt: string;
  itemCount: number;
}

export interface Order extends OrderSummary {
  addressLine1: string;
  addressLine2: string | null;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressLandmark: string | null;
  deliveryNotes: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: OrderItem[];
  invoices: OrderInvoice[];
  statusHistory: {
    id: number;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    note: string;
    createdAt: string;
  }[];
}

/**
 * What `POST /checkout` returns. Deliberately smaller than a full order: the
 * client redirects to the confirmation route, which re-reads the order under
 * the customer's own scope rather than trusting this payload to render itself.
 */
export interface CheckoutResult {
  orderId: number;
  orderNumber: string;
  invoiceNumber: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  stockCommitted: boolean;
  paymentRequired: false;
  notice: string;
  items: { name: string; quantity: number; lineTotal: number }[];
}

export interface OrderConfirmation {
  order: {
    id: number;
    orderNumber: string;
    status: OrderStatus;
    placedAt: string;
    subtotal: number;
    discountTotal: number;
    total: number;
    paymentRequired: false;
    notice: string;
    items: OrderItem[];
    address: {
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      postalCode: string;
    };
  };
  invoice: OrderInvoice | null;
}