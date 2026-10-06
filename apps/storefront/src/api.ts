import type {
  Address,
  AddressBookEntryInput,
  Cart,
  CartPreview,
  Category,
  CheckoutInput,
  CheckoutResult,
  Customer,
  HomePayload,
  Order,
  OrderConfirmation,
  OrderSummary,
  PageMeta,
  Product,
  ProductDetail,
  ProductImage,
  RelatedProduct,
  SiteConfig,
  StaticPage,
} from "./types.js";

interface Envelope<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; requestId: string; details?: unknown };
}

/**
 * Every response from the API is a uniform envelope, so unwrapping lives here
 * once. `meta` is returned alongside the payload because list routes carry
 * pagination there rather than inside the payload body.
 */
async function requestEnvelope<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; meta?: PageMeta }> {
  const response = await fetch(path, {
    ...init,
    // Auth and the guest cart both ride on cookies, so they must be included.
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | Envelope<T>
    | ErrorEnvelope
    | null;

  if (!body) throw new ApiError("EMPTY_RESPONSE", `No response body from ${path}`, response.status);

  if (!body.success) {
    // The server's code and message are safe to show; the request id is not.
    throw new ApiError(body.error.code, body.error.message, response.status, body.error.details);
  }

  return { data: body.data, meta: body.meta };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestEnvelope<T>(path, init)).data;
}

async function requestList<T>(
  path: string,
  init?: RequestInit,
): Promise<{ items: T[]; meta: PageMeta }> {
  const { data, meta } = await requestEnvelope<T[]>(path, init);
  return {
    items: data,
    meta: meta ?? { page: 1, pageSize: data.length, total: data.length, totalPages: 1 },
  };
}

function json(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Query values the product list accepts. Empty strings mean "unset". */
export interface ProductQuery {
  category?: string;
  search?: string;
  sort?: string;
  inStock?: string;
  featured?: string;
  page?: number;
  pageSize?: number;
}

function productPath(params: ProductQuery): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const search = query.toString();
  return `/api/public/products${search ? `?${search}` : ""}`;
}

export const api = {
  /* ------------------------------ catalogue ------------------------------ */

  home: () => request<HomePayload>("/api/public/home"),
  config: () => request<SiteConfig>("/api/public/config"),
  page: (slug: string) =>
    request<{ page: StaticPage }>(`/api/public/pages/${encodeURIComponent(slug)}`).then(
      (r) => r.page,
    ),
  categories: () => request<{ categories: Category[] }>("/api/public/categories"),
  products: (params: ProductQuery) => requestList<Product>(productPath(params)),
  product: (slug: string) =>
    request<{ product: ProductDetail }>(`/api/public/products/${encodeURIComponent(slug)}`).then(
      (r) => r.product,
    ),

  /** Type-ahead suggestions for the header search field. */
  suggest: (term: string, limit = 5) =>
    requestList<Product>(productPath({ search: term, pageSize: limit, sort: "newest" })),

  /* --------------------------------- cart -------------------------------- */

  cart: () => request<Cart>("/api/shop/cart"),
  cartPreview: (offerCode?: string) =>
    request<CartPreview>(
      `/api/shop/cart/preview${offerCode ? `?offerCode=${encodeURIComponent(offerCode)}` : ""}`,
    ),
  addToCart: (productId: number, quantity: number) =>
    request<Cart>("/api/shop/cart/items", json({ productId, quantity })),
  setQuantity: (productId: number, quantity: number) =>
    request<Cart>(`/api/shop/cart/items/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity }),
    }),
  removeItem: (productId: number) =>
    request<Cart>(`/api/shop/cart/items/${productId}`, {
      method: "DELETE",
      body: JSON.stringify({ productId }),
    }),
  mergeCart: () => request<Cart>("/api/shop/cart/merge", { method: "POST" }),
  clearCart: () => request<Cart>("/api/shop/cart", { method: "DELETE" }),

  /* ------------------------------- checkout ------------------------------ */

  checkout: (body: CheckoutInput) => request<CheckoutResult>("/api/shop/checkout", json(body)),

  /* -------------------------------- orders ------------------------------- */

  /**
   * Unlike the catalogue list, this route sends the pagination envelope inside
   * `data` rather than in the envelope's own `meta`, so it is unpacked here
   * instead of going through `requestList`.
   */
  orders: (page = 1, status?: string) => {
    const query = new URLSearchParams({ page: String(page), pageSize: "10" });
    if (status) query.set("status", status);
    return request<{ items: OrderSummary[]; meta: PageMeta }>(`/api/shop/orders?${query}`);
  },

  order: (id: number) => request<{ order: Order }>(`/api/shop/orders/${id}`).then((r) => r.order),
  orderConfirmation: (id: number) =>
    request<OrderConfirmation>(`/api/shop/order-confirmation/${id}`),
  invoiceUrl: (id: number) => `/api/shop/orders/${id}/invoice`,

  /* --------------------------------- auth -------------------------------- */

  session: () =>
    request<{ authenticated: boolean; user: Customer | null }>("/api/auth/session").then((r) =>
      r.user,
    ),
  login: (email: string, password: string) =>
    request<{ user: Customer }>("/api/auth/login", json({ email, password })).then((r) => r.user),
  register: (body: { email: string; password: string; fullName: string; phone?: string }) =>
    request<{ user: Customer }>("/api/auth/register", json(body)).then((r) => r.user),
  logout: () => request<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" }),
  updateProfile: (body: { fullName?: string; phone?: string }) =>
    request<{ user: Customer }>("/api/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }).then((r) => r.user),
  addresses: () => request<{ addresses: Address[] }>("/api/auth/addresses").then((r) => r.addresses),
  addAddress: (body: AddressBookEntryInput) =>
    request<{ address: Address }>("/api/auth/addresses", json(body)).then((r) => r.address),
  deleteAddress: (id: number) =>
    request<{ deleted: boolean }>(`/api/auth/addresses/${id}`, { method: "DELETE" }),
};

/**
 * The list route picks a primary image server-side, but the detail route does
 * not, so the shared card code asks for it through here instead of duplicating
 * the fallback logic.
 */
/**
 * Placeholder imagery while the catalogue has no uploads yet. Swap these paths
 * for real product media as it is added.
 */
export const PLACEHOLDER_IMAGES = {
  product: "/images/product.webp",
  hero: "/images/hero.webp",
  category: "/images/category.webp",
  feature: "/images/feature.webp",
} as const;

export function primaryImageOf(
  product: { images: ProductImage[]; primaryImage?: ProductImage | null },
): ProductImage | null {
  const found = product.primaryImage ?? product.images[0] ?? null;
  if (found) return found;
  return {
    id: 0,
    url: PLACEHOLDER_IMAGES.product,
    altText: "Product image",
    isPrimary: true,
    sortOrder: 0,
  };
}

/** Title and price are all a related-product rail renders. */
export function asRelatedCard(product: RelatedProduct): {
  id: number;
  name: string;
  slug: string;
  price: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  unitLabel: string;
  category: null;
  images: ProductImage[];
  primaryImage: ProductImage | null;
} {
  return {
    ...product,
    isOnSale: product.compareAtPrice !== null && product.compareAtPrice > product.price,
    category: null,
    primaryImage: product.images[0] ?? null,
  };
}

/**
 * Prices cross the wire as integer minor units. Formatting is done from those
 * integers rather than by dividing floats, matching the server's rule that no
 * float ever represents money.
 */
export function formatMoney(minorUnits: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

/**
 * Discount percentage for a badge, rounded down. Used only for display; the
 * server remains the authority on what is actually charged.
 */
export function discountPercent(price: number, compareAtPrice: number | null): number | null {
  if (!compareAtPrice || compareAtPrice <= price) return null;
  return Math.floor(((compareAtPrice - price) / compareAtPrice) * 100);
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}