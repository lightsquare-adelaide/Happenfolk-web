import { describe, expect, it } from "vitest";
import { formatEventDate, orderEvents, registrationStatusLabel } from "./dashboard";

describe("orderEvents", () => {
  it("lists upcoming events soonest first, then past events most recent first", () => {
    const at = (id: string, starts_at: string) => ({ id, starts_at });
    const events = [
      at("far", "2027-03-01T00:00:00Z"),
      at("old", "2026-01-01T00:00:00Z"),
      at("soon", "2026-10-20T00:00:00Z"),
      at("recent", "2026-10-01T00:00:00Z"),
    ];
    const ids = orderEvents(events, new Date("2026-10-12T00:00:00Z")).map((e) => e.id);
    expect(ids).toEqual(["soon", "far", "recent", "old"]);
  });
});

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
