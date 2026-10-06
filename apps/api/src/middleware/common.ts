import crypto from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

/* ------------------------- request correlation id ------------------------ */

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

export const requestId: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.header("x-request-id");
  req.id = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
};

/* -------------------------------- logging -------------------------------- */

export const accessLog: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Health checks would otherwise dominate the log volume.
    if (req.path === "/health") return;
    const line = {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: (req as Request & { auth?: { id?: number } }).auth?.id,
    };
    if (res.statusCode >= 500) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "http", ...line }));
    } else {
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "http", ...line }));
    }
  });
  next();
};

/* ---------------------------- security headers ---------------------------- */

/* The API's own responses are JSON or uploaded media, never a document, so the
 * strictest possible policy applies. When a built storefront/admin is served
 * from the same origin (see STOREFRONT_DIR / ADMIN_DIR) the document responses
 * need a working policy instead: hashed Vite assets from 'self', Google-hosted
 * fonts, and the inline style attributes React sets on elements. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export const securityHeaders: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const servesApp = Boolean(env.STOREFRONT_DIR || env.ADMIN_DIR);
  const isApiRoute =
    req.path.startsWith("/api") || req.path.startsWith("/health") || req.path.startsWith("/uploads");
  res.setHeader("Content-Security-Policy", servesApp && !isApiRoute ? APP_CSP : API_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.removeHeader("X-Powered-By");
  next();
};

/* --------------------------- database liveness --------------------------- */

/**
 * Proves the database is reachable before the listening socket opens, so the
 * first request never discovers it cannot be served. Retries briefly because a
 * container start can beat the database by a second or two.
 */
export async function assertDatabaseReady(attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      const last = attempt === attempts;
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: last ? "database.unreachable" : "database.retry",
          attempt,
          err: error instanceof Error ? error.message : String(error),
        }),
      );
      if (last) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

/* --------------------------- graceful shutdown --------------------------- */

/**
 * Fail fast on an unhandled rejection rather than continuing in an unknown
 * state, which is how silent data corruption starts.
 */
export function installProcessGuards(): void {
  process.on("unhandledRejection", (reason) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "unhandledRejection",
        err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : { message: String(reason) },
      }),
    );
  });

  process.on("uncaughtException", (error) => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "uncaughtException",
        err: { message: error.message, stack: error.stack },
      }),
    );
    process.exit(1);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "shutdown.started", signal }),
    );
    const forceExit = setTimeout(() => {
      console.error(
        JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "shutdown.forced" }),
      );
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await prisma.$disconnect();
      clearTimeout(forceExit);
      console.log(
        JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "shutdown.complete" }),
      );
      process.exit(0);
    } catch (error) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          msg: "shutdown.failed",
          err: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exit(1);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

/* ------------------------------ misc utils ------------------------------- */

export function clientIp(req: Request): string {
  if (env.TRUST_PROXY) {
    const forwarded = req.header("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export function userAgent(req: Request): string | undefined {
  const ua = req.header("user-agent");
  return ua ? ua.slice(0, 255) : undefined;
}