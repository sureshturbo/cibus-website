import { Router } from "express";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { sendOk } from "../lib/http.js";

export const healthRouter = Router();

/**
 * This router is mounted at `/health`, so its internal paths must not repeat that
 * prefix: declaring `/health` here would serve `/health/health` and leave the
 * conventional probe URL returning 404.
 */
const API_VERSION = "1.0.0";

/**
 * Liveness: the process is up. No dependency checks, so a transient database
 * blip does not cause an orchestrator to kill an otherwise healthy process.
 */
healthRouter.get("/", (_req, res) => {
  sendOk(res, {
    status: "ok",
    service: "cibus-api",
    version: API_VERSION,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness: the process can actually serve traffic. Used as the deployment
 * probe and by the smoke test.
 */
healthRouter.get("/ready", async (_req, res) => {
  const checks: Record<string, { status: "ok" | "fail"; latencyMs?: number; detail?: string }> = {};

  const dbStart = Date.now();
  try {
    await db.queryOne("SELECT 1");
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: "fail",
      latencyMs: Date.now() - dbStart,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }

  const storageStart = Date.now();
  try {
    await db.queryOne("SELECT id FROM products LIMIT 1");
    checks.schema = { status: "ok", latencyMs: Date.now() - storageStart };
  } catch (error) {
    checks.schema = {
      status: "fail",
      latencyMs: Date.now() - storageStart,
      detail: error instanceof Error ? error.message : "schema unavailable",
    };
  }

  const ready = Object.values(checks).every((c) => c.status === "ok");
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: {
      status: ready ? "ready" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    },
  });
});