/**
 * Environment configuration.
 *
 * Validated at boot. A missing or malformed variable throws here, so the process
 * refuses to start rather than failing mid-request at 2am on a checkout.
 */

import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Locate the package root by walking up until package.json appears.
 *
 * A fixed number of `..` hops cannot work: the compiled file lives at
 * dist/config/env.js while tsx runs the source at src/config/env.ts. Anchoring on
 * package.json is the only approach that holds for both, and for any future
 * nesting level.
 */
function findPackageRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return start;
}

const apiRoot = findPackageRoot(here);
const repoRoot = findPackageRoot(path.dirname(apiRoot));

// Overriding false: a real environment variable always wins over the file.
loadDotenv({ path: path.join(apiRoot, ".env"), override: false });
loadDotenv({ path: path.join(repoRoot, ".env"), override: false });

const csv = z
  .string()
  .min(1)
  .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const booleanish = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SHADOW_DATABASE_URL: z.string().min(1).optional(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().min(1).default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  CORS_ORIGINS: csv.default("http://localhost:5173,http://localhost:5174"),
  TRUST_PROXY: booleanish.default("false"),

  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
  SERVE_UPLOADS: booleanish.default("true"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  SEED_ADMIN_EMAIL: z.string().email().default("admin@cibus.local"),
  SEED_ADMIN_PASSWORD: z.string().min(10).default("ChangeMe!2026"),
  SEED_ADMIN_NAME: z.string().min(2).default("Cibus Administrator"),

  COMPANY_NAME: z.string().default("Cibus Trading"),
  COMPANY_EMAIL: z.string().default("hello@cibus.example"),
  COMPANY_PHONE: z.string().default("+91 00000 00000"),
  COMPANY_ADDRESS: z.string().default("Cibus Trading, Business Address, India"),
  INVOICE_PREFIX: z.string().min(1).max(8).default("INV"),
  CURRENCY: z.string().length(3).default("INR"),

  /* Storefront capabilities, surfaced by GET /api/public/config so the clients
   * branch on server truth instead of a copy baked into the bundle. */
  OFFER_CODES_ENABLED: booleanish.default("true"),
  /**
   * False by design: an order must belong to a customer account so it can be
   * tracked and reordered. Visitors may still browse and fill a guest cart; the
   * storefront sends them to sign in at checkout, and /cart/merge folds the
   * basket into the account. Set true only if guest checkout is implemented.
   */
  GUEST_CHECKOUT_ENABLED: booleanish.default("false"),
  MAX_QUANTITY_PER_LINE: z.coerce.number().int().min(1).max(999).default(100),
});

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";

  if (isProduction) {
    const problems: string[] = [];
    if (env.JWT_ACCESS_SECRET.startsWith("dev-")) problems.push("JWT_ACCESS_SECRET is a dev default");
    if (env.JWT_REFRESH_SECRET.startsWith("dev-")) problems.push("JWT_REFRESH_SECRET is a dev default");
    if (env.SEED_ADMIN_PASSWORD === "ChangeMe!2026") problems.push("SEED_ADMIN_PASSWORD is the default");
    if (env.CORS_ORIGINS.includes("localhost")) problems.push("CORS_ORIGINS still allows localhost");
    if (problems.length > 0) {
      throw new Error(`Refusing to start in production with insecure defaults:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    }
  }

  return {
    ...env,
    isProduction,
    isTest: env.NODE_ENV === "test",
    isDevelopment: env.NODE_ENV === "development",
  };
}

export const env = load();
export type Env = typeof env;