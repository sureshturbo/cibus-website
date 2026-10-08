import mysql from "mysql2/promise";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { env } from "../config/env.js";

/**
 * The single query interface the rest of the API talks to.
 *
 * `query` returns plain row objects (camelCase aliases are applied in SQL), and
 * `execute` returns the affected-row header. Both hide mysql2's `[result, fields]`
 * tuple so service code reads like the previous `prisma.*` calls.
 */
export interface Executor {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown[]]>;
}

/** Row shape every SELECT returns; declare a concrete interface that extends it. */
export type Row = RowDataPacket;

export function parseDatabaseUrl(raw: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    throw new Error(`DATABASE_URL must use the mysql:// scheme (got ${url.protocol}//)`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!database) throw new Error("DATABASE_URL is missing a database name");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    /* The URL API leaves userinfo percent-encoded; the driver needs the decoded
     * value, so a password containing @, ^ or , still connects. */
    password: decodeURIComponent(url.password),
    database,
  };
}

/** Cached on globalThis so tsx watch-mode reloads reuse one pool. */
const globalForDb = globalThis as unknown as { cibusPool?: Pool };

export const pool: Pool =
  globalForDb.cibusPool ??
  mysql.createPool({
    ...parseDatabaseUrl(env.DATABASE_URL),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
    /* DATETIME columns were written as UTC by Prisma; read them the same way so a
     * value does not shift when it round-trips through either layer. */
    timezone: "Z",
    supportBigNumbers: true,
    dateStrings: false,
    /* MySQL has no native boolean; TINYINT(1) is what Prisma used. Coerce it so
     * rows carry real booleans, matching the Prisma-produced shapes. */
    typeCast(field, next) {
      if (field.type === "TINY" && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === "1";
      }
      return next();
    },
  });

if (!env.isProduction) {
  globalForDb.cibusPool = pool;
}

/** Run a SELECT and return its rows typed as TRow. */
export async function query<TRow = Row>(
  sql: string,
  params: readonly unknown[] = [],
  conn: Executor = pool,
): Promise<TRow[]> {
  const [rows] = await conn.query(sql, params as unknown[]);
  return rows as TRow[];
}

/** Run a SELECT expected to match at most one row. */
export async function queryOne<TRow = Row>(
  sql: string,
  params: readonly unknown[] = [],
  conn: Executor = pool,
): Promise<TRow | null> {
  const rows = await query<TRow>(sql, params, conn);
  return rows[0] ?? null;
}

/** Run an INSERT/UPDATE/DELETE and return the affected-row header. */
export async function execute(
  sql: string,
  params: readonly unknown[] = [],
  conn: Executor = pool,
): Promise<ResultSetHeader> {
  const [result] = await conn.query(sql, params as unknown[]);
  return result as ResultSetHeader;
}

/** Transaction-scoped helpers handed to a `transaction()` callback. */
export interface Tx {
  query<TRow = Row>(sql: string, params?: readonly unknown[]): Promise<TRow[]>;
  queryOne<TRow = Row>(sql: string, params?: readonly unknown[]): Promise<TRow | null>;
  execute(sql: string, params?: readonly unknown[]): Promise<ResultSetHeader>;
}

/**
 * Pool-scoped helpers with the same surface as a transaction, so repository
 * functions accept one `Tx` argument and work identically whether the caller is
 * inside a transaction or not.
 */
export const db: Tx = {
  query: (sql, params = []) => query(sql, params, pool),
  queryOne: (sql, params = []) => queryOne(sql, params, pool),
  execute: (sql, params = []) => execute(sql, params, pool),
};

/**
 * Run `fn` inside a single connection's transaction.
 *
 * The connection is released in `finally`; a rollback failure is swallowed
 * because the original error is the one worth surfacing and a poisoned
 * connection is discarded rather than returned to the pool.
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  const tx: Tx = {
    query: (sql, params = []) => query(sql, params, conn),
    queryOne: (sql, params = []) => queryOne(sql, params, conn),
    execute: (sql, params = []) => execute(sql, params, conn),
  };
  try {
    await conn.beginTransaction();
    try {
      const result = await fn(tx);
      await conn.commit();
      return result;
    } catch (error) {
      try {
        await conn.rollback();
      } catch {
        /* Unreachable rollback means the socket is gone; release() disposes it. */
      }
      throw error;
    }
  } finally {
    conn.release();
  }
}

/** Acquire a connection and confirm the server answers. */
export async function connectDatabase(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

export async function disconnectDatabase(): Promise<void> {
  await pool.end();
}