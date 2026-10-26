import { describe, expect, it } from "vitest";
import {
  adelaideWallTimeToInstant,
  canTransition,
  instantToAdelaideWallClock,
  eventCategoryProblem,
  eventDescriptionProblem,
  eventInstantProblem,
  eventLocationProblem,
  eventTimesProblem,
  eventTitleProblem,
  isUuid,
  jsonObjectProblem,
  transitionProblem,
  unsupportedFieldProblem,
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_TITLE_MAX,
} from "./events";

describe("status machine", () => {
  it("runs draft -> published -> cancelled and stops", () => {
    expect(canTransition("draft", "published")).toBe(true);
    expect(canTransition("published", "cancelled")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(false);
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("cancelled", "published")).toBe(false);
  });

  it("explains illegal transitions and treats no-ops as fine", () => {
    expect(transitionProblem("draft", "published")).toBeNull();
    expect(transitionProblem("draft", "draft")).toBeNull();
    expect(transitionProblem("cancelled", "published")).toContain("cannot be republished");
    expect(transitionProblem("draft", "cancelled")).toContain("cannot be cancelled directly");
  });
});

describe("field limits", () => {
  it("requires a trimmed, bounded name", () => {
    expect(eventTitleProblem(undefined)).toBe("Event name is required");
    expect(eventTitleProblem(null)).toBe("Event name is required");
    expect(eventTitleProblem("  ")).toBe("Event name is required");
    expect(eventTitleProblem(42)).toBe("Event name must be text");
    expect(eventTitleProblem("x".repeat(EVENT_TITLE_MAX + 1))).toContain(String(EVENT_TITLE_MAX));
    expect(eventTitleProblem("  Salon  ")).toBeNull();
  });

  it("requires a location and bounds it", () => {
    expect(eventLocationProblem(null)).toBe("Event location is required");
    expect(eventLocationProblem(undefined)).toBe("Event location is required");
    expect(eventLocationProblem(42)).toBe("Event location must be text");
    expect(eventLocationProblem("")).toBe("Event location is required");
    expect(eventLocationProblem("x".repeat(EVENT_LOCATION_MAX + 1))).toContain(String(EVENT_LOCATION_MAX));
    expect(eventLocationProblem(" Adelaide Town Hall ")).toBeNull();
  });

  it("keeps the description optional but bounded", () => {
    expect(eventDescriptionProblem(null)).toBeNull();
    expect(eventDescriptionProblem(undefined)).toBeNull();
    expect(eventDescriptionProblem("hello")).toBeNull();
    expect(eventDescriptionProblem([])).toBe("Description must be text");
    expect(eventDescriptionProblem("x".repeat(EVENT_DESCRIPTION_MAX + 1))).toContain(
      String(EVENT_DESCRIPTION_MAX),
    );
  });

  it("accepts only smallint category ids", () => {
    expect(eventCategoryProblem(null)).toBeNull();
    expect(eventCategoryProblem(3)).toBeNull();
    expect(eventCategoryProblem("4")).toBeNull();
    expect(eventCategoryProblem(0)).toBe("Invalid category");
    expect(eventCategoryProblem(1.5)).toBe("Invalid category");
    expect(eventCategoryProblem(70000)).toBe("Invalid category");
    expect(eventCategoryProblem("abc")).toBe("Invalid category");
  });
});

describe("instants and times", () => {
  it("accepts only unambiguous ISO instants with an offset", () => {
    expect(eventInstantProblem("2026-03-01T10:00:00Z")).toBeNull();
    expect(eventInstantProblem("2026-03-01T10:00:00+10:30")).toBeNull();
    expect(eventInstantProblem("2026-03-01T10:00:00-05:00")).toBeNull();
    expect(eventInstantProblem("2026-03-01T10:00")).toContain("timezone offset");
    expect(eventInstantProblem("10:00 2026-03-01")).toContain("ISO-8601");
    expect(eventInstantProblem(null)).toBe("Date and time must be text");
  });

  it("rejects impossible calendar components even when Date.parse rolls them over", () => {
    // V8 rolls 2027-02-30 over to 2 March and hour 24 to the next day;
    // the component checks must reject both, not trust Date.parse.
    expect(eventInstantProblem("2027-02-30T09:00:00Z")).toContain("real calendar moment");
    expect(eventInstantProblem("2027-01-01T24:00:00Z")).toContain("Hour must be between 00 and 23");
    expect(eventInstantProblem("2027-04-31T09:00:00Z")).toContain("real calendar moment");
    expect(eventInstantProblem("2027-13-01T09:00:00Z")).toContain("real calendar moment");
    expect(eventInstantProblem("2027-01-01T09:61:00Z")).toContain("real calendar moment");
    // Leap-year day is real and must pass.
    expect(eventInstantProblem("2028-02-29T09:00:00Z")).toBeNull();
  });

  it("requires end not before start", () => {
    expect(eventTimesProblem("2026-03-01T10:00:00Z", "2026-03-01T12:00:00Z")).toBeNull();
    expect(eventTimesProblem("2026-03-01T10:00:00Z", null)).toBeNull();
    expect(eventTimesProblem("2026-03-01T12:00:00Z", "2026-03-01T10:00:00Z")).toBe(
      "End time cannot be before the start time",
    );
    expect(eventTimesProblem("soon", null)).toMatch(/^Start: /);
    expect(eventTimesProblem("2026-03-01T10:00:00Z", "late")).toMatch(/^End: /);
  });
});

describe("request body guards", () => {
  it("rejects non-object JSON bodies", () => {
    expect(jsonObjectProblem(null)).toContain("JSON object");
    expect(jsonObjectProblem([])).toContain("JSON object");
    expect(jsonObjectProblem("x")).toContain("JSON object");
    expect(jsonObjectProblem({})).toBeNull();
  });

  it("names the first unsupported field instead of dropping it", () => {
    expect(unsupportedFieldProblem({ title: "x", host_id: "y" }, ["title"])).toBe(
      "Unsupported field: host_id",
    );
    expect(unsupportedFieldProblem({ title: "x" }, ["title", "status"])).toBeNull();
  });

  it("validates UUID shapes", () => {
    expect(isUuid("6f1e2d3c-4b5a-4968-8797-a6b5c4d3e2f1")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("instantToAdelaideWallClock (render side)", () => {
  it("renders summer and winter instants with the real offsets", () => {
    expect(instantToAdelaideWallClock("2026-01-15T09:30:00.000Z")).toEqual({ date: "2026-01-15", time: "20:00" });
    expect(instantToAdelaideWallClock("2026-07-15T10:30:00.000Z")).toEqual({ date: "2026-07-15", time: "20:00" });
  });

  it("round-trips every converted instant back to the same wall reading", () => {
    for (const [date, time] of [
      ["2026-01-15", "20:00"], ["2026-07-15", "20:00"],
      ["2026-10-04", "01:59"], ["2026-10-04", "03:00"],
      ["2026-04-05", "01:59"], ["2026-04-05", "03:00"],
    ] as const) {
      const instant = adelaideWallTimeToInstant(date, time);
      expect(instant.ok ? instant.iso : instant).not.toBe(false);
      if (instant.ok) {
        expect(instantToAdelaideWallClock(instant.iso)).toEqual({ date, time });
      }
    }
  });

  it("returns empty strings for an unparsable instant", () => {
    expect(instantToAdelaideWallClock("nonsense")).toEqual({ date: "", time: "" });
  });
});

describe("adelaideWallTimeToInstant (real Australia/Adelaide rules)", () => {
  // 2026 DST boundaries in Adelaide: forward 4 Oct 02:00 -> 03:00 ACST,
  // back 5 Apr 03:00 -> 02:00 ACDT.
  it("uses +10:30 in summer", () => {
    const result = adelaideWallTimeToInstant("2026-01-15", "20:00");
    expect(result).toEqual({ ok: true, iso: "2026-01-15T09:30:00.000Z", offsetMinutes: 630 });
  });

  it("uses +09:30 in winter", () => {
    const result = adelaideWallTimeToInstant("2026-07-15", "20:00");
    expect(result).toEqual({ ok: true, iso: "2026-07-15T10:30:00.000Z", offsetMinutes: 570 });
  });

  it("rejects the spring-forward hour that does not exist", () => {
    const gap = adelaideWallTimeToInstant("2026-10-04", "02:30");
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.kind).toBe("nonexistent");
  });

  it("converts both edges of the spring-forward gap", () => {
    expect(adelaideWallTimeToInstant("2026-10-04", "01:59")).toEqual({
      ok: true, iso: "2026-10-03T16:29:00.000Z", offsetMinutes: 570,
    });
    expect(adelaideWallTimeToInstant("2026-10-04", "03:00")).toEqual({
      ok: true, iso: "2026-10-03T16:30:00.000Z", offsetMinutes: 630,
    });
  });

  it("rejects the autumn hour that happens twice", () => {
    const repeated = adelaideWallTimeToInstant("2026-04-05", "02:30");
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.kind).toBe("ambiguous");
  });

  it("converts both edges of the autumn repeat", () => {
    expect(adelaideWallTimeToInstant("2026-04-05", "01:59")).toEqual({
      ok: true, iso: "2026-04-04T15:29:00.000Z", offsetMinutes: 630,
    });
    expect(adelaideWallTimeToInstant("2026-04-05", "03:00")).toEqual({
      ok: true, iso: "2026-04-04T17:30:00.000Z", offsetMinutes: 570,
    });
  });

  it("rejects impossible dates and malformed input", () => {    const feb30 = adelaideWallTimeToInstant("2026-02-30", "10:00");
    expect(feb30.ok).toBe(false);
    if (!feb30.ok) expect(feb30.kind).toBe("invalid_date");
    const badTime = adelaideWallTimeToInstant("2026-01-01", "25:00");
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) expect(badTime.kind).toBe("invalid_time");
    const badShape = adelaideWallTimeToInstant("01/15/2026", "8pm");
    expect(badShape.ok).toBe(false);
  });
});
