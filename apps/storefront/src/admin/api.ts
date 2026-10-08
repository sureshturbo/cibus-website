import type {
  Admin,
  AdminCategory,
  AdminOrder,
  AdminProduct,
  AdminProductImage,
  CategoryInput,
  DashboardSummary,
  Enquiry,
  Paginated,
  ProductInput,
} from "./types.js";

interface Envelope<T> {
  success: true;
  data: T;
}

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; requestId: string };
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Notified when the session cannot be recovered, so the shell returns to login. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

const NO_RETRY = ["/api/admin/auth/login", "/api/admin/auth/refresh", "/api/admin/auth/logout", "/api/admin/auth/session"];

async function parse<T>(response: Response, path: string): Promise<T> {
  if (response.status === 204) return undefined as T;

  const body = (await response.json().catch(() => null)) as Envelope<T> | ErrorEnvelope | null;

  if (!body) throw new ApiError("EMPTY_RESPONSE", `No response body from ${path}`, response.status);

  if (!body.success) throw new ApiError(body.error.code, body.error.message, response.status);

  return body.data;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  // FormData must keep the browser-generated multipart boundary, so it must not
  // be forced to application/json the way a plain object body is.
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  return fetch(path, {
    ...init,
    // Admin tokens are httpOnly cookies, so they must be sent explicitly.
    credentials: "include",
    headers: {
      ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);

  if (response.status !== 401 || NO_RETRY.includes(path)) {
    return parse<T>(response, path);
  }

  // Access tokens are short-lived but a refresh token outlives them, so a 401
  // here is usually recoverable rather than the end of the session.
  const refreshed = await send("/api/admin/auth/refresh", { method: "POST" });
  if (!refreshed.ok) {
    onUnauthorized();
    return parse<T>(response, path);
  }

  return parse<T>(await send(path, init), path);
}

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ admin: Admin }>("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }).then((r) => r.admin),

  session: () => request<{ admin: Admin }>("/api/admin/auth/session").then((r) => r.admin),

  logout: () => request<{ loggedOut: boolean }>("/api/admin/auth/logout", { method: "POST" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ passwordChanged: boolean }>("/api/admin/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  dashboard: () => request<DashboardSummary>("/api/admin/dashboard"),

  products: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return request<Paginated<AdminProduct>>(`/api/admin/products${query ? `?${query}` : ""}`);
  },
  setProductActive: (id: number, isActive: boolean) =>
    request<unknown>(`/api/admin/products/${id}/active`, {
      method: "PATCH",
      body: JSON.stringify({ isActive }),
    }),
  // The featured route reuses activeToggleSchema, so the field is still `isActive`
  // even though it drives isFeatured. The server aliases it on the way in.
  setProductFeatured: (id: number, isFeatured: boolean) =>
    request<unknown>(`/api/admin/products/${id}/featured`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: isFeatured }),
    }),

  createProduct: (input: ProductInput) =>
    request<{ product: AdminProduct }>("/api/admin/products", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.product),

  updateProduct: (id: number, input: ProductInput) =>
    request<{ product: AdminProduct }>(`/api/admin/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.product),

  uploadProductImage: (productId: number, file: File, altText = "") => {
    const body = new FormData();
    body.append("file", file);
    if (altText) body.append("altText", altText);
    return request<{ image: AdminProductImage }>(`/api/admin/products/${productId}/images`, {
      method: "POST",
      body,
    }).then((r) => r.image);
  },

  deleteProductImage: (imageId: number) =>
    request<{ deleted: boolean }>(`/api/admin/images/${imageId}`, { method: "DELETE" }),

  lowStock: () => request<{ products: AdminProduct[] }>("/api/admin/products/low-stock").then((r) => r.products),

  adjustStock: (input: {
    productId: number;
    quantityChange: number;
    type: string;
    referenceType: string;
    referenceId?: string;
    note?: string;
  }) =>
    request<unknown>("/api/admin/stock/adjust", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  orders: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return request<Paginated<AdminOrder>>(`/api/admin/orders${query ? `?${query}` : ""}`);
  },
  setOrderStatus: (id: number, status: string, note?: string) =>
    request<unknown>(`/api/admin/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note: note ?? "" }),
    }),

  categories: (params: Record<string, string> = {}) => {
    const query = new URLSearchParams(params).toString();
    return request<{ categories: AdminCategory[] }>(`/api/admin/categories${query ? `?${query}` : ""}`).then(
      (r) => r.categories,
    );
  },

  createCategory: (input: CategoryInput) =>
    request<{ category: AdminCategory }>("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.category),

  updateCategory: (id: number, input: Partial<CategoryInput>) =>
    request<{ category: AdminCategory }>(`/api/admin/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((r) => r.category),

  deleteCategory: (id: number) =>
    request<{ deleted: boolean }>(`/api/admin/categories/${id}`, { method: "DELETE" }),

  enquiries: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return request<Paginated<Enquiry>>(`/api/admin/enquiries${query ? `?${query}` : ""}`);
  },
  setEnquiryStatus: (id: number, status: string, notes?: string) =>
    request<unknown>(`/api/admin/enquiries/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status, notes: notes ?? "" }),
    }),

  customers: (params: Record<string, string>) => {
    const query = new URLSearchParams(params).toString();
    return request<Paginated<{ id: number; fullName: string; email: string; isActive: boolean }>>(
      `/api/admin/customers${query ? `?${query}` : ""}`,
    );
  },
};

export function formatMoney(minorUnits: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}