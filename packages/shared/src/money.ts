/**
 * Money is represented as integer minor units (paise) everywhere.
 *
 * Rationale: floating point cannot represent 0.10 exactly, and accumulated
 * rounding errors produce totals that do not reconcile. Integer paise are
 * exact and JSON-safe, unlike bigint (which Prisma returns as BigInt and
 * cannot be serialised to JSON without a custom replacer).
 */

/** Integer paise. Always a whole number. */
export type Minor = number;

/** Hard ceiling on any single stored amount: 21,474,836 major units. */
export const MINOR_MAX = 2_147_483_647;

/** Hard floor: negative amounts are never storable. */
export const MINOR_MIN = 0;

const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/** Convert a major-unit value (number or numeric string) to integer paise. */
export function toMinor(major: number | string): Minor {
  const s = typeof major === "number" ? major.toString() : major.trim();
  if (!AMOUNT_PATTERN.test(s)) {
    throw new Error(`Invalid monetary amount: ${s}`);
  }
  const [whole = "0", frac = ""] = s.split(".");
  const paise = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Amount out of range: ${s}`);
  }
  return paise;
}

/** Convert integer paise back to a major-unit number. Display use only. */
export function fromMinor(minor: Minor): number {
  return minor / 100;
}

export function formatMinor(minor: Minor, currency = "INR", locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(fromMinor(minor));
}

export function addMinor(...values: Minor[]): Minor {
  return values.reduce((total, v) => total + v, 0);
}

export function multiplyMinor(minor: Minor, quantity: number): Minor {
  return Math.round(minor * quantity);
}

export function assertStorableMinor(value: Minor, label: string): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number of paise, got ${value}`);
  }
  if (value < MINOR_MIN) {
    throw new Error(`${label} must not be negative, got ${value}`);
  }
  if (value > MINOR_MAX) {
    throw new Error(`${label} exceeds the maximum storable amount, got ${value}`);
  }
  return value;
}