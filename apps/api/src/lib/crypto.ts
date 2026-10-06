import argon2 from "argon2";
import crypto from "node:crypto";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

/* ------------------------------ hashing ---------------------------------- */

/**
 * argon2id with conservative parameters. Passwords are never logged, returned
 * by an API, or stored in any form other than this hash.
 */
const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash in the database must read as "invalid credentials",
    // never as a crash or a 500.
    return false;
  }
}

/* -------------------------------- tokens --------------------------------- */

export type TokenAudience = "customer" | "admin";

export interface AccessTokenClaims {
  sub: number;
  aud: TokenAudience;
  email: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"],
    audience: claims.aud,
    issuer: "cibus-api",
  };
  // The email has to be in the payload: verifyAccessToken requires the claim, so
  // signing an empty object made every freshly issued token fail its own check.
  return jwt.sign({ email: claims.email }, env.JWT_ACCESS_SECRET, {
    ...options,
    subject: String(claims.sub),
  });
}

export function verifyAccessToken(token: string, audience: TokenAudience): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      audience,
      issuer: "cibus-api",
    }) as JwtPayload & { email?: string };
    const sub = Number(decoded.sub);
    if (!Number.isInteger(sub) || sub <= 0 || typeof decoded.email !== "string") return null;
    return { sub, aud: audience, email: decoded.email };
  } catch {
    return null;
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs. Only their SHA-256
 * digest is stored, so a database leak does not hand over live sessions and a
 * session can be revoked by deleting its row.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiryDate(): Date {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_REFRESH_TTL);
  if (!match) return new Date(Date.now() + 30 * 86_400_000);
  const amount = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  const unitMs: Record<typeof unit, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return new Date(Date.now() + amount * unitMs[unit]);
}

/* ------------------------- generic signed payload ------------------------ */

export function signPayload(payload: Record<string, unknown>, expiresIn: string): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: expiresIn as SignOptions["expiresIn"],
    issuer: "cibus-api",
  });
}

export function verifyPayload<T extends JwtPayload>(token: string): T | null {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: "cibus-api" }) as T;
  } catch {
    return null;
  }
}