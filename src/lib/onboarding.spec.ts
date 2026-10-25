import { describe, expect, it } from "vitest";
import { afterOnboardingPath } from "./onboarding";

describe("afterOnboardingPath", () => {
  it("returns a same-site target with its query", () => {
    expect(afterOnboardingPath("/events/abc?ref=feed")).toBe("/events/abc?ref=feed");
  });

  it("falls back to /dashboard for missing or non-string input", () => {
    expect(afterOnboardingPath(null)).toBe("/dashboard");
    expect(afterOnboardingPath(undefined)).toBe("/dashboard");
  });

  it("rejects external and normalised scheme-relative targets", () => {
    expect(afterOnboardingPath("//example.com")).toBe("/dashboard");
    expect(afterOnboardingPath("/.//example.com")).toBe("/dashboard");
  });

  it("never points back at onboarding, which would loop", () => {
    expect(afterOnboardingPath("/onboarding")).toBe("/dashboard");
    expect(afterOnboardingPath("/onboarding?next=%2Fx")).toBe("/dashboard");
    expect(afterOnboardingPath("/onboarding/step")).toBe("/dashboard");
  });

  it("keeps paths that merely start with the same letters", () => {
    expect(afterOnboardingPath("/onboardingguide")).toBe("/onboardingguide");
  });
});
