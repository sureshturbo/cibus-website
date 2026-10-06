import type { NextFunction, Request, Response } from "express";
import { NotFoundError } from "../lib/errors.js";

/**
 * Wraps an async route handler so a rejected promise reaches the Express error
 * pipeline. Without this an awaited rejection hangs the request forever.
 */
export function controller<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req as unknown as Req, res, next).catch(next);
  };
}

/** Read a validated route parameter, rejecting anything that is not a positive integer. */
export function param(req: Request, name: string): number {
  const raw = req.params[name];
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new NotFoundError("Resource");
  }
  return value;
}

/**
 * Read a validated non-empty string route parameter.
 *
 * Express types `req.params` loosely, so this narrows it in one place instead of
 * scattering non-null assertions across every handler.
 */
export function stringParam(req: Request, name: string): string {
  const raw = req.params[name];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new NotFoundError("Resource");
  }
  return raw;
}