import type { Request, RequestHandler } from "express";

/**
 * Small helpers that keep controllers free of repetitive conversion code.
 */

export function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length === 0 ? null : s;
}

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function bool(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

export function optional<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

export function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is required`);
  return value;
}

/** Trim and collapse a textarea into a single-line summary for list views. */
export function summarise(text: string, length = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= length ? flat : `${flat.slice(0, length - 1)}…`;
}

/**
 * Deterministic slug generator. Appends a short suffix only when needed so
 * slugs stay readable rather than becoming opaque identifiers.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
  return base || "item";
}

export function dateRangeDays(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
}

/** Today's date in IST-style business terms, used to derive the financial year. */
export function currentFinancialYear(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Padded sequence segment, e.g. 42 -> "0042". */
export function sequenceSegment(value: number, width = 4): string {
  return value.toString().padStart(width, "0");
}

export function ipFromRequest(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}