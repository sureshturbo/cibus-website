import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { ERROR_CODES } from "@cibus/shared";
import { AppError, ValidationError } from "./errors.js";
import { logger } from "./logger.js";
import { isForeignKeyError, isUniqueConstraintError } from "../db/errors.js";

/* ----------------------------- envelopes --------------------------------- */

export function sendOk<T, TMeta = never>(
  res: Response,
  data: T,
  status = 200,
  meta?: TMeta,
): Response {
  return res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

/* ------------------------- async error wrapping -------------------------- */

/** Forwards rejected promises to the Express error pipeline. */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/* ------------------------------ validation ------------------------------- */

function formatIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** Parse and validate a request segment, throwing a 400 with per-field detail. */
export function parse<T extends ZodTypeAny>(schema: T, payload: unknown): z.infer<T> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ValidationError("Some fields need your attention", formatIssues(result.error));
  }
  return result.data;
}

/** Express middleware factory for validating body, query, or params. */
export function validate<T extends ZodTypeAny>(schema: T, source: "body" | "query" | "params" = "body"): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new ValidationError("Some fields need your attention", formatIssues(result.error)));
      return;
    }
    // req.query is a getter in Express 5; assigning a fresh object avoids surprises.
    if (source === "query") {
      Object.defineProperty(req, "validatedQuery", { value: result.data, configurable: true });
      (req as Request & { query: unknown }).query = result.data;
    } else {
      req[source] = result.data;
    }
    next();
  };
}

/** Read the result of a `validate(..., "query")` middleware. */
export function validatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}

/* ------------------------------- 404 / error ----------------------------- */

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(
      404,
      ERROR_CODES.NOT_FOUND,
      `No route matches ${req.method} ${req.originalUrl.split("?")[0]}`,
    ),
  );
}

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/* ------------------------------- handlers -------------------------------- */

interface SqlLikeError {
  code?: string;
  sqlMessage?: string;
  message?: string;
  meta?: { target?: string | string[]; field_name?: string };
}

/** Turn a duplicate-key error into a field name a customer can act on. */
function describeUniqueViolation(error: SqlLikeError): string {
  // mysql2: "Duplicate entry 'x' for key 'products.sku'" (key may be UQ_... or the column).
  const sql = error.sqlMessage ?? error.message ?? "";
  const keyMatch = /for key '([^']+)'/.exec(sql);
  if (keyMatch) {
    const fullKey = keyMatch[1] ?? "";
    const key = fullKey.split(".").pop() ?? fullKey;
    return `That ${key} is already in use`;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.join(", ") : (target ?? error.meta?.field_name ?? "value");
  return `That ${fields} is already in use`;
}

/**
 * Final error handler. Anything that is not an AppError becomes a generic 500
 * with the detail logged, never returned - stack traces and SQL do not leak.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = (req as Request & { id?: string }).id;

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error("http.error", error, { requestId, path: req.originalUrl });
    } else {
      logger.warn("http.client_error", { requestId, code: error.code, message: error.message });
    }
    const body: ErrorBody = { code: error.code, message: error.message, requestId };
    if (error.details !== undefined) body.details = error.details;
    res.status(error.status).json({ success: false, error: body });
    return;
  }

  if (isUniqueConstraintError(error)) {
    const message = describeUniqueViolation(error as SqlLikeError);
    logger.warn("http.conflict", { requestId, message });
    res.status(409).json({
      success: false,
      error: { code: ERROR_CODES.CONFLICT, message, requestId },
    });
    return;
  }

  if (isForeignKeyError(error)) {
    logger.warn("http.bad_reference", { requestId });
    res.status(409).json({
      success: false,
      error: {
        code: ERROR_CODES.CONFLICT,
        message: "That operation references a record that does not exist",
        requestId,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Some fields need your attention",
        details: formatIssues(error),
        requestId,
      },
    });
    return;
  }

  if (isBodyParseError(error)) {
    res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Request body is not valid JSON", requestId },
    });
    return;
  }

  if (isPayloadTooLarge(error)) {
    res.status(413).json({
      success: false,
      error: { code: ERROR_CODES.PAYLOAD_TOO_LARGE, message: "Request body is too large", requestId },
    });
    return;
  }

  logger.error("http.unhandled_error", error, { requestId, path: req.originalUrl, method: req.method });
  res.status(500).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL,
      message: "Something went wrong on our end. Please try again.",
      requestId,
    },
  });
}

function isBodyParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as SyntaxError & { status: number }).status === 400
  );
}

function isPayloadTooLarge(error: unknown): boolean {
  return typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
}