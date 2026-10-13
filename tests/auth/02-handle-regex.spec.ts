import { describe, expect, it } from "vitest";
import { handleProblem, isValidAccountKind, isValidHandle } from "../../src/lib/onboarding";

describe("P2 — handle shape rules (pure functions)", () => {
  it("accepts handles matching ^[a-z0-9_]{3,30}$", () => {
    for (const good of ["abc", "a_b_c", "a".repeat(30), "handle_123", "x9_"]) {
      expect(isValidHandle(good), good).toBe(true);
      expect(handleProblem(good), good).toBeNull();
    }
  });

  it("rejects malformed handles with a reason", () => {
    for (const bad of [
      "",
      "ab", // too short
      "a".repeat(31), // too long
      "Has-Upper", // uppercase + dash
      "has space",
      "häsö", // non-ascii
      "-leading",
      "trailing-",
      "double__underscore_ok_but_dash_no",
    ]) {
      expect(isValidHandle(bad), bad).toBe(false);
      expect(handleProblem(bad), bad).toBeTruthy();
    }
  });

  it("account kind accepts exactly the two enum values", () => {
    expect(isValidAccountKind("individual")).toBe(true);
    expect(isValidAccountKind("organisation")).toBe(true);
    expect(isValidAccountKind("organisation ")).toBe(false);
    expect(isValidAccountKind("admin")).toBe(false);
  });
});
