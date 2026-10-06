import { describe, expect, it } from "vitest";
import {
  MINOR_MAX,
  addMinor,
  assertStorableMinor,
  formatMinor,
  fromMinor,
  multiplyMinor,
  toMinor,
} from "./money.js";

describe("toMinor", () => {
  it("converts a two-decimal string exactly", () => {
    // The value that actually appears in the client and the admin panel.
    expect(toMinor("249.00")).toBe(24_900);
  });

  it("pads a missing fractional part", () => {
    expect(toMinor("249")).toBe(24_900);
    expect(toMinor("249.5")).toBe(24_950);
  });

  it("rejects more than two decimals instead of truncating", () => {
    // Truncating would quietly turn 10.999 into 10.99 - an amount the customer
    // never typed. Refusing the input surfaces the problem at the form.
    expect(() => toMinor("10.999")).toThrow(/invalid/i);
  });

  it("handles zero", () => {
    expect(toMinor("0")).toBe(0);
    expect(toMinor("0.00")).toBe(0);
  });

  it("rejects a negative amount", () => {
    expect(() => toMinor("-1.00")).toThrow(/invalid/i);
  });

  it("rejects a value with too many integer digits", () => {
    expect(() => toMinor("1234567890")).toThrow(/invalid/i);
  });

  it("rejects a float supplied as a number with more precision than paise", () => {
    // 0.1 + 0.2 style drift must not be silently rounded into a different amount.
    expect(() => toMinor(0.30000000000000004)).toThrow(/invalid/i);
  });

  it("rejects non-numeric input", () => {
    expect(() => toMinor("abc")).toThrow(/invalid/i);
  });
});

describe("fromMinor", () => {
  it("round-trips a two-decimal value", () => {
    expect(fromMinor(toMinor("249.00"))).toBe(249);
  });

  it("round-trips an odd paise amount without drift", () => {
    // 0.1 is the classic float failure case: 10 * 0.1 === 0.9999... in binary.
    expect(fromMinor(toMinor("0.10"))).toBe(0.1);
  });

  it("round-trips the maximum storable amount", () => {
    expect(fromMinor(toMinor(String(MINOR_MAX / 100)))).toBe(MINOR_MAX / 100);
  });
});

describe("formatMinor", () => {
  it("renders two decimal places", () => {
    expect(formatMinor(24_900)).toMatch(/249\.00/);
  });

  it("renders paise rather than rounding them away", () => {
    expect(formatMinor(1)).toMatch(/0\.01/);
    expect(formatMinor(99)).toMatch(/0\.99/);
  });
});

describe("arithmetic", () => {
  it("adds amounts without float drift", () => {
    expect(addMinor(10, 20, 30)).toBe(60);
  });

  it("multiplies an amount by a whole quantity", () => {
    expect(multiplyMinor(6_800, 2)).toBe(13_600);
    expect(multiplyMinor(6_800, 3)).toBe(20_400);
  });

  it("keeps a line total a whole number of paise", () => {
    // A fractional-paise line total would not survive a database round trip.
    expect(Number.isInteger(multiplyMinor(1_999, 3))).toBe(true);
    expect(multiplyMinor(1_999, 3)).toBe(5_997);
  });
});

describe("assertStorableMinor", () => {
  it("accepts a value inside the range", () => {
    expect(assertStorableMinor(24_900, "Price")).toBe(24_900);
  });

  it("accepts zero", () => {
    expect(assertStorableMinor(0, "Price")).toBe(0);
  });

  it("rejects a fractional value", () => {
    expect(() => assertStorableMinor(249.5, "Price")).toThrow(/whole number/i);
  });

  it("rejects a negative value", () => {
    expect(() => assertStorableMinor(-1, "Price")).toThrow(/negative/i);
  });

  it("rejects a value above the storage ceiling", () => {
    expect(() => assertStorableMinor(MINOR_MAX + 1, "Price")).toThrow(/maximum/i);
  });
});