import type { Request } from "express";

/**
 * Structured logger. Emits newline-delimited JSON so a process manager or log
 * shipper can parse it, and adds a correlation id to every line.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = LEVEL_ORDER.info;

export function setLogLevel(level: LogLevel): void {
  threshold = LEVEL_ORDER[level];
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= threshold;
}

function serialiseError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: envSafeStack(error),
      ...(typeof error === "object" && "code" in error ? { code: (error as { code?: unknown }).code } : {}),
    };
  }
  return { message: String(error) };
}

function envSafeStack(error: Error): string | undefined {
  // Stacks are useless in production noise but valuable in development.
  return threshold <= LEVEL_ORDER.debug || process.env.NODE_ENV !== "production" ? error.stack : undefined;
}

function emit(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
  if (!isLevelEnabled(level)) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context,
  };
  const sink = level === "error" || level === "warn" ? process.stderr : process.stdout;
  sink.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, error?: unknown, context: Record<string, unknown> = {}) =>
    emit("error", message, error ? { ...context, err: serialiseError(error) } : context),
};

export function requestLogger(req: Request): void {
  return logger.info("http.request", {
    method: req.method,
    path: req.originalUrl.split("?")[0],
    requestId: (req as Request & { id?: string }).id,
  });
}