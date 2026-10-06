import express, { Router } from "express";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { AppError, NotFoundError } from "./lib/errors.js";
import { errorHandler, notFoundHandler, sendOk } from "./lib/http.js";
import { isServableUpload } from "./lib/storage.js";
import { absoluteUploadDir, ensureUploadDir } from "./lib/storage.js";
import {
  accessLog,
  assertDatabaseReady,
  requestId,
  securityHeaders,
} from "./middleware/common.js";
import { generalLimiter } from "./middleware/rateLimit.js";
import { adminRouter } from "./routes/admin.routes.js";
import { adminAuthRouter } from "./routes/adminAuth.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { enquiryRouter } from "./routes/enquiry.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { publicRouter } from "./routes/public.routes.js";
import { shopRouter } from "./routes/shop.routes.js";

export function createApp(): Express {
  const app = express();

  /* Reverse proxies must be trusted explicitly for client IPs and secure
   * cookies to be correct; blind trust lets any client spoof its address. */
  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.set("etag", "strong");

  app.use(requestId);
  app.use(securityHeaders);
  app.use(accessLog);

  app.use(
    helmet({
      contentSecurityPolicy: false, // set explicitly in securityHeaders: this API serves no HTML
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server requests arrive without an Origin.
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowed = env.CORS_ORIGINS.includes(origin);
        callback(allowed ? null : new AppError(403, "FORBIDDEN", `Origin ${origin} is not allowed`), allowed);
      },
      credentials: true, // auth cookies are cross-origin capable
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Content-Disposition"],
      maxAge: 600,
    }),
  );

  app.use(compression());
  app.use(cookieParser());

  /* JSON only. A file upload endpoint uses multipart and is handled by multer,
   * so a size cap here is enough to blunt body-flooding attempts. */
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));

  /* Scoped to the API. When the built UIs are served from this origin each page
   * load pulls many hashed assets, and a shared-IP office would otherwise burn
   * the whole per-IP budget on static files. */
  app.use("/api", generalLimiter);

  /* ------------------------------- routes ------------------------------- */

  /**
   * The API serves no HTML; a root that just 404s makes it look broken when a
   * human opens the base URL in a browser. Point at the real entry points
   * instead.
   */
  if (!env.STOREFRONT_DIR) {
    app.get("/", (_req, res) => {
      sendOk(res, {
        service: "cibus-api",
        version: "1.0.0",
        environment: env.NODE_ENV,
        paths: {
          health: "/health",
          readiness: "/health/ready",
          api: "/api",
        },
      });
    });
  }

  app.use("/health", healthRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/shop", shopRouter);
  app.use("/api/enquiries", enquiryRouter);

  /* Admin surface lives under its own prefix so a route added here is never
   * reachable without passing through requireAdmin. */
  app.use("/api/admin/auth", adminAuthRouter);
  app.use("/api/admin", adminRouter);

  /* Uploaded media. Only known-safe extensions are served, and the directory is
   * mounted without directory listing. */
  if (env.SERVE_UPLOADS) {
    app.use(
      "/uploads",
      (req: Request, res: Response, next) => {
        if (!isServableUpload(req.path)) {
          next(new NotFoundError("File"));
          return;
        }
        res.setHeader("X-Content-Type-Options", "nosniff");
        // Long cache: filenames are content-random and never reused.
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Cross-Origin-Resource-Policy", "same-site");
        next();
      },
      express.static(path.resolve(absoluteUploadDir()), {
        index: false,
        dotfiles: "deny",
        fallthrough: true,
        maxAge: "365d",
      }),
    );
  }

  /* Optional single-origin hosting: serve the built storefront/admin so the
   * browser stays on one origin and the httpOnly auth cookies need no cross-site
   * setup. Registered after the API routes, so /api, /health and /uploads always
   * win. All of this is unset in development. */
  const adminPath = env.ADMIN_PATH.replace(/\/+$/, "") || "/admin";

  if (env.ADMIN_DIR) {
    const adminDir = path.resolve(env.ADMIN_DIR);
    app.use(adminPath, express.static(adminDir, { dotfiles: "deny" }));
    app.get(`${adminPath}/*`, (req: Request, res: Response, next: () => void) => {
      /* A missing asset (a path with an extension) is a 404, not the SPA shell. */
      if (path.extname(req.path)) {
        next();
        return;
      }
      res.sendFile(path.join(adminDir, "index.html"));
    });
  }

  if (env.STOREFRONT_DIR) {
    const storefrontDir = path.resolve(env.STOREFRONT_DIR);
    app.use(express.static(storefrontDir, { dotfiles: "deny" }));
    app.get("*", (req: Request, res: Response, next) => {
      /* Never let the SPA fallback answer an API path or the admin panel: those
       * must 404 as JSON, or be handled by the admin block above. And a request
       * for a missing asset (an extension) is a 404, not the SPA shell. */
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/health") ||
        req.path.startsWith("/uploads") ||
        path.extname(req.path) ||
        (env.ADMIN_DIR && (req.path === adminPath || req.path.startsWith(`${adminPath}/`)))
      ) {
        next();
        return;
      }
      res.sendFile(path.join(storefrontDir, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Prepare directories and verify dependencies before accepting traffic. */
export async function prepare(): Promise<void> {
  await ensureUploadDir();
  await assertDatabaseReady();
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "database.ready" }));
}