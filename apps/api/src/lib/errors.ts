/**
 * Typed application errors.
 *
 * Anything thrown that is not an AppError is treated as a bug and reported as a
 * generic 500, so internal details never leak to clients.
 */

import { ERROR_CODES, type ErrorCode } from "@cibus/shared";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
    Error.captureStackTrace?.(this, AppError);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, ERROR_CODES.VALIDATION_FAILED, message, details);
    this.name = "ValidationError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, ERROR_CODES.UNAUTHENTICATED, message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource") {
    super(403, ERROR_CODES.FORBIDDEN, message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, ERROR_CODES.NOT_FOUND, `${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, ERROR_CODES.CONFLICT, message, details);
    this.name = "ConflictError";
  }
}

export class InsufficientStockError extends AppError {
  constructor(
    message: string,
    readonly unavailable: Array<{ productId: number; name: string; requested: number; available: number }>,
  ) {
    super(409, ERROR_CODES.INSUFFICIENT_STOCK, message, { unavailable });
    this.name = "InsufficientStockError";
  }
}

export class ProductUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, ERROR_CODES.PRODUCT_UNAVAILABLE, message, details);
    this.name = "ProductUnavailableError";
  }
}

export class IllegalStatusTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, ERROR_CODES.ILLEGAL_STATUS_TRANSITION, `An order cannot move from ${from} to ${to}`);
    this.name = "IllegalStatusTransitionError";
  }
}

export class OfferInvalidError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, ERROR_CODES.OFFER_INVALID, message, details);
    this.name = "OfferInvalidError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again shortly.") {
    super(429, ERROR_CODES.RATE_LIMITED, message);
    this.name = "RateLimitError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(503, ERROR_CODES.SERVICE_UNAVAILABLE, message);
    this.name = "ServiceUnavailableError";
  }
}