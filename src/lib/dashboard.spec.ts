import { describe, expect, it } from "vitest";
import { formatEventDate, registrationStatusLabel } from "./dashboard";

describe("registrationStatusLabel", () => {
  it("labels every schema status and passes unknown values through", () => {
    expect(registrationStatusLabel("payment_failed")).toBe("Payment failed");
    expect(registrationStatusLabel("confirmed")).toBe("Confirmed");
    expect(registrationStatusLabel("mystery")).toBe("mystery");
  });
});

describe("formatEventDate", () => {
  it("shows Adelaide local time, including daylight saving", () => {
    // 09:30 UTC on 1 Nov 2026 is 20:00 ACDT (UTC+10:30).
    expect(formatEventDate("2026-11-01T09:30:00Z")).toMatch(/1 Nov 2026.*8:00\s?pm/i);
  });
});
