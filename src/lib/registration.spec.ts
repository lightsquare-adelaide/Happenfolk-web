import { describe, expect, it } from "vitest";
import { canRegisterWithoutPayment, isUuid, registrationErrorMessage } from "./registration";

describe("event registration safeguards", () => {
  it("accepts only UUID-shaped identifiers", () => {
    expect(isUuid("9dd8dfc6-a93a-435f-9b91-1044c25552f1")).toBe(true);
    expect(isUuid("../../admin")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("only offers free registration on published events", () => {
    expect(canRegisterWithoutPayment({ status: "published", price_cents: 0 })).toBe(true);
    expect(canRegisterWithoutPayment({ status: "draft", price_cents: 0 })).toBe(false);
    expect(canRegisterWithoutPayment({ status: "published", price_cents: 500 })).toBe(false);
  });

  it("maps known RPC errors without exposing database diagnostics", () => {
    expect(registrationErrorMessage("EVENT_FULL")).toMatch(/no places/i);
    expect(registrationErrorMessage("EVENT_NOT_FOUND_OR_NOT_PUBLISHED")).toMatch(/no longer/i);
    expect(registrationErrorMessage("sql details: xyz")).not.toContain("sql details");
  });
});
