import { describe, expect, it } from "vitest";
import {
  DISCOVERY_LIMIT_DEFAULT,
  DISCOVERY_LIMIT_MAX,
  DISCOVERY_LIMIT_MIN,
  DISCOVERY_QUERY_MAX_BYTES,
  clampDiscoveryLimit,
  discoveryQueryByteLength,
  normalizeDiscoveryCategory,
  normalizeDiscoveryQuery,
  validateDiscoveryQuery,
} from "./discovery";

/**
 * DB-free unit tests for the pure discovery query rules. The database
 * side of the same contract (clamping, QUERY_TOO_LONG, browse mode) is
 * exercised against the real stack in tests/discovery/04-search.spec.ts.
 */

describe("clampDiscoveryLimit", () => {
  it("applies the default for missing or non-finite input", () => {
    expect(clampDiscoveryLimit(null)).toBe(DISCOVERY_LIMIT_DEFAULT);
    expect(clampDiscoveryLimit(undefined)).toBe(DISCOVERY_LIMIT_DEFAULT);
    expect(clampDiscoveryLimit(Number.NaN)).toBe(DISCOVERY_LIMIT_DEFAULT);
    expect(clampDiscoveryLimit(Number.POSITIVE_INFINITY)).toBe(DISCOVERY_LIMIT_DEFAULT);
  });

  it("clamps into 1..100 like least(greatest(...)) in the RPCs", () => {
    expect(clampDiscoveryLimit(0)).toBe(DISCOVERY_LIMIT_MIN);
    expect(clampDiscoveryLimit(-50)).toBe(DISCOVERY_LIMIT_MIN);
    expect(clampDiscoveryLimit(100000)).toBe(DISCOVERY_LIMIT_MAX);
    expect(clampDiscoveryLimit(50)).toBe(50);
    expect(clampDiscoveryLimit(1)).toBe(1);
    expect(clampDiscoveryLimit(100)).toBe(100);
  });

  it("truncates fractional limits", () => {
    expect(clampDiscoveryLimit(24.9)).toBe(24);
  });
});

describe("normalizeDiscoveryQuery", () => {
  it("turns empty or whitespace-only input into browse mode (null)", () => {
    expect(normalizeDiscoveryQuery(null)).toBeNull();
    expect(normalizeDiscoveryQuery(undefined)).toBeNull();
    expect(normalizeDiscoveryQuery("")).toBeNull();
    expect(normalizeDiscoveryQuery("   \t\n ")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDiscoveryQuery("  pottery  ")).toBe("pottery");
  });
});

describe("validateDiscoveryQuery", () => {
  it("accepts queries within the byte budget", () => {
    expect(validateDiscoveryQuery("x".repeat(DISCOVERY_QUERY_MAX_BYTES))).toEqual({
      ok: true,
      query: "x".repeat(DISCOVERY_QUERY_MAX_BYTES),
    });
    // 100 two-byte characters = exactly 200 bytes: still fine.
    expect(validateDiscoveryQuery("é".repeat(100)).ok).toBe(true);
  });

  it("rejects over-budget queries with the RPC's error name", () => {
    expect(validateDiscoveryQuery("x".repeat(DISCOVERY_QUERY_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: "QUERY_TOO_LONG",
    });
    // Byte length, not character count: 101 x 2 bytes = 202 > 200.
    expect(validateDiscoveryQuery("é".repeat(101))).toEqual({
      ok: false,
      reason: "QUERY_TOO_LONG",
    });
  });

  it("measures bytes in UTF-8", () => {
    expect(discoveryQueryByteLength("abc")).toBe(3);
    expect(discoveryQueryByteLength("é")).toBe(2);
    expect(discoveryQueryByteLength("\u20ac")).toBe(3); // euro sign: 3 bytes in UTF-8
  });
});

describe("normalizeDiscoveryCategory", () => {
  it("maps empty-ish values to all-categories (null)", () => {
    expect(normalizeDiscoveryCategory(null)).toBeNull();
    expect(normalizeDiscoveryCategory(undefined)).toBeNull();
    expect(normalizeDiscoveryCategory("")).toBeNull();
  });

  it("keeps valid smallint category ids", () => {
    expect(normalizeDiscoveryCategory(1)).toBe(1);
    expect(normalizeDiscoveryCategory("7")).toBe(7);
  });

  it("rejects junk instead of smuggling it into SQL parameters", () => {
    expect(normalizeDiscoveryCategory("abc")).toBeNull();
    expect(normalizeDiscoveryCategory(0)).toBeNull();
    expect(normalizeDiscoveryCategory(-3)).toBeNull();
    expect(normalizeDiscoveryCategory(1.5)).toBeNull();
    expect(normalizeDiscoveryCategory(99999)).toBeNull();
  });
});
