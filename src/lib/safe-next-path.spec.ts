import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

// Hermetic regression for the open redirect on /login?next=... .
// `startsWith("/")` alone accepted scheme-relative URLs; these cases go red
// if that check is ever restored.
describe("safeNextPath", () => {
  it("keeps a normal same-site path", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/onboarding")).toBe("/onboarding");
  });

  it("keeps query and hash on a same-site path", () => {
    expect(safeNextPath("/events/42?tab=orders#top")).toBe(
      "/events/42?tab=orders#top",
    );
  });

  it("falls back when next is missing or empty", () => {
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it("rejects a scheme-relative URL (//host)", () => {
    expect(safeNextPath("//example.com")).toBe("/dashboard");
    expect(safeNextPath("//example.com/dashboard")).toBe("/dashboard");
    expect(safeNextPath("///example.com")).toBe("/dashboard");
  });

  it("rejects the backslash variant browsers normalise to //host", () => {
    expect(safeNextPath("/\\example.com")).toBe("/dashboard");
    expect(safeNextPath("/\\/example.com")).toBe("/dashboard");
  });

  it("rejects absolute and protocol URLs", () => {
    expect(safeNextPath("https://example.com")).toBe("/dashboard");
    expect(safeNextPath("http://example.com/dashboard")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("rejects anything that does not start with a slash", () => {
    expect(safeNextPath("dashboard")).toBe("/dashboard");
    expect(safeNextPath("example.com/dashboard")).toBe("/dashboard");
  });

  it.each(["/.//example.com", "/a/..//example.com", "/%2e//example.com"])(
    "rejects a target that becomes scheme-relative after normalisation: %s",
    (input) => {
      expect(safeNextPath(input)).toBe("/dashboard");
    },
  );

  it("preserves safe normalised paths with query and hash", () => {
    expect(safeNextPath("/events/../dashboard?tab=events#upcoming")).toBe(
      "/dashboard?tab=events#upcoming",
    );
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("//example.com", "/")).toBe("/");
  });
});
