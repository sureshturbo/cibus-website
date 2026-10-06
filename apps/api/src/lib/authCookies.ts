import type { Response } from "express";
import { env } from "../config/env.js";

/**
 * Session cookies.
 *
 * Tokens live in httpOnly cookies rather than localStorage: a single XSS flaw
 * then cannot read them, and the browser attaches them automatically so no
 * JavaScript handles credentials at all.
 *
 * SameSite=Lax blocks cross-site POSTs (CSRF) while allowing top-level GET
 * navigation, which is all the storefront needs. `Secure` is enforced in
 * production.
 */

export const ACCESS_COOKIE = "cibus_access";
export const REFRESH_COOKIE = "cibus_refresh";
export const CART_COOKIE = "cibus_cart";

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.isProduction,
  path: "/",
} as const;

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1000),
  );

  // Express's `maxAge` is milliseconds, not seconds. Passing seconds here made
  // the access cookie expire on arrival (15m -> Max-Age=0) and quietly shortened
  // the refresh cookie (30d -> 43 minutes), so every protected request 401'd.
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: parseDurationSeconds(env.JWT_ACCESS_TTL) * 1000,
  });

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: maxAgeSeconds * 1000,
  });
}

/** The guest basket cookie. Same hardening as session cookies: not readable by JS. */
export const CART_COOKIE_OPTIONS = {
  ...BASE_COOKIE_OPTIONS,
  maxAge: 60 * 60 * 24 * 30, // 30 days
} as const;

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, BASE_COOKIE_OPTIONS);
  res.clearCookie(REFRESH_COOKIE, BASE_COOKIE_OPTIONS);
}

export const CHANGE_COOKIE_SECONDS = parseDurationSeconds(env.JWT_REFRESH_TTL);

/**
 * Convert a duration string ("15m", "30d", "2h", "45s") to seconds.
 * Falls back to 15 minutes if the value is not recognised.
 */
export function parseDurationSeconds(duration: string, fallbackSeconds = 900): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(duration.trim());
  if (!match) return fallbackSeconds;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s") as "s" | "m" | "h" | "d";
  const multipliers: Record<typeof unit, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
  return amount * multipliers[unit];
}