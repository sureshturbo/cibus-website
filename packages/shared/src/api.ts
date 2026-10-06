/** Shape of every successful API response envelope. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/**
 * A cart or order line as priced by the server. All amounts are integer paise.
 * `unitPrice` is always read from the catalogue, never accepted from a client.
 */
export interface PricingLine {
  productId: number;
  categoryId: number;
  unitPrice: number;
  quantity: number;
}

/** Stable machine-readable error codes the clients may branch on. */
export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  ILLEGAL_STATUS_TRANSITION: "ILLEGAL_STATUS_TRANSITION",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  OFFER_INVALID: "OFFER_INVALID",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  INTERNAL: "INTERNAL",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function paginate<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    items,
    meta: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };
}