import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { TokenAudience } from "../lib/crypto.js";
import { verifyAccessToken } from "../lib/crypto.js";
import { ACCESS_COOKIE } from "../lib/authCookies.js";
import { ForbiddenError, UnauthenticatedError } from "../lib/errors.js";
import { findActiveAdminById, findActiveCustomerById } from "../db/repositories/auth.repo.js";

export interface AuthContext {
  id: number;
  audience: TokenAudience;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

/**
 * The access token, from an explicit Bearer header or otherwise from the
 * httpOnly cookie that sign-in sets.
 *
 * The cookie is not optional convenience: because it is httpOnly, no browser
 * script can read it back to build an Authorization header, so a request that
 * only looked at the header left every cookie-based session unable to call a
 * protected route at all.
 */
function readToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header) {
    const [scheme, token] = header.split(" ");
    if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
    return token.trim();
  }

  const cookie = req.cookies?.[ACCESS_COOKIE];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}

/**
 * Rejects the request unless a valid, unexpired access token is present.
 * The user record is re-read on every request so a deactivated account loses
 * access immediately rather than when its token happens to expire.
 */
function requireAuth(audience: TokenAudience): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = readToken(req);
      if (!token) throw new UnauthenticatedError();

      const claims = verifyAccessToken(token, audience);
      if (!claims) throw new UnauthenticatedError("Your session has expired. Please sign in again.");

      const active =
        audience === "admin"
          ? await findActiveAdminById(claims.sub)
          : await findActiveCustomerById(claims.sub);

      if (!active) throw new ForbiddenError("This account is no longer active");

      req.auth = { id: claims.sub, audience, email: claims.email };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireCustomer = requireAuth("customer");
export const requireAdmin = requireAuth("admin");

/**
 * Attaches the auth context when a token is present but never rejects. Used on
 * endpoints that behave differently for signed-in customers but stay open.
 */
export function optionalCustomer(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) {
    next();
    return;
  }
  const claims = verifyAccessToken(token, "customer");
  if (claims) {
    req.auth = { id: claims.sub, audience: "customer", email: claims.email };
  }
  next();
}

export function currentCustomerId(req: Request): number {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth.id;
}

export function currentAdminId(req: Request): number {
  if (!req.auth) throw new ForbiddenError("Administrator access required");
  return req.auth.id;
}