import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env.js";

/**
 * Rate limiting.
 *
 * Authentication endpoints get a much tighter budget than general API traffic,
 * because that is where credential stuffing actually lands.
 */

/**
 * Bucket an IP-based limiter.
 *
 * IPv6 hands a single subscriber a /64, so keying on the raw address lets one
 * client rotate through billions of addresses and bypass the limit entirely.
 * ipKeyGenerator normalises to a subnet, and express-rate-limit warns when a
 * custom keyGenerator does not use it.
 */
function ipBucket(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

/**
 * Bucket by user when signed in, falling back to IP.
 *
 * Per-user is what we want for checkout: a shared office NAT should not have all
 * its customers throttled by one busy customer.
 */
function userBucket(req: Request): string {
  const id = (req as Request & { auth?: { id?: number } }).auth?.id;
  return id ? `u:${id}` : ipBucket(req);
}

function build(keyGenerator: (req: Request) => string, overrides: Partial<Options> = {}) {
  return rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator,
    // Rate limiting is environment-specific and would make tests flaky.
    skip: () => env.isTest,
    ...overrides,
  });
}

export const generalLimiter = build(ipBucket, {
  windowMs: 60_000,
  limit: 300,
});

/** Brute-force protection for login, register, refresh, and password change. */
export const authLimiter = build(ipBucket, {
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many attempts. Please wait a few minutes and try again.",
    },
  },
});

export const checkoutLimiter = build(userBucket, {
  windowMs: 60_000,
  limit: 20,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many checkout attempts. Please slow down." },
  },
});

export const enquiryLimiter = build(ipBucket, {
  windowMs: 60 * 60_000,
  limit: 5,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "You have submitted several enquiries already. We will be in touch soon.",
    },
  },
});

export const uploadLimiter = build(ipBucket, {
  windowMs: 60_000,
  limit: 30,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many uploads. Please try again shortly." },
  },
});