import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

/**
 * Single shared client. Cached on globalThis so tsx watch-mode reloads reuse
 * one pool instead of leaking a new connection set on every file change.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment ? ["warn", "error"] : ["error"],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  const [row] = await prisma.$queryRawUnsafe<Array<{ now: Date }>>("SELECT NOW() AS now");
  if (!row) throw new Error("Database did not respond to a timestamp probe");
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function isForeignKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2003";
}

export function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}