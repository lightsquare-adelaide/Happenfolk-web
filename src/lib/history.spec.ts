import { describe, expect, it } from "vitest";
import {
  eventStatusText,
  historyLink,
  hostedInvolvementLabel,
  splitHistoryTimeline,
  type HistoryRow,
} from "./history";

const now = new Date("2026-10-30T06:00:00Z");
const row = (kind: HistoryRow["kind"], startsAt: string | null): HistoryRow => ({ kind, startsAt });

describe("splitHistoryTimeline", () => {
  it("splits upcoming (soonest first) and past (most recent first)", () => {
    const rows = [
      row("hosted", "2027-03-01T00:00:00Z"), // upcoming, far
      row("registered", "2026-01-01T00:00:00Z"), // past, old
      row("registered", "2026-11-20T00:00:00Z"), // upcoming, soon
      row("hosted", "2026-10-01T00:00:00Z"), // past, recent
    ];
    const timeline = splitHistoryTimeline(rows, now);
    expect(timeline.upcoming.map((r) => r.startsAt)).toEqual([
      "2026-11-20T00:00:00Z",
      "2027-03-01T00:00:00Z",
    ]);
    expect(timeline.past.map((r) => r.startsAt)).toEqual([
      "2026-10-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    ]);
    expect(timeline.unavailable).toEqual([]);
  });

  it("counts an event starting exactly now as upcoming", () => {
    const timeline = splitHistoryTimeline([row("registered", "2026-10-30T06:00:00Z")], now);
    expect(timeline.upcoming).toHaveLength(1);
    expect(timeline.past).toHaveLength(0);
  });

  it("sinks rows without a visible event into unavailable", () => {
    const rows = [
      row("registered", null),
      row("hosted", "2026-11-20T00:00:00Z"),
      row("registered", null),
    ];
    const timeline = splitHistoryTimeline(rows, now);
    expect(timeline.unavailable).toEqual([rows[0], rows[2]]);
    expect(timeline.upcoming.map((r) => r.startsAt)).toEqual(["2026-11-20T00:00:00Z"]);
    expect(timeline.past).toEqual([]);
  });

  it("keeps hosted rows ahead of registered rows with the same start", () => {
    const rows = [
      row("registered", "2026-11-01T00:00:00Z"),
      row("hosted", "2026-11-01T00:00:00Z"),
    ];
    expect(splitHistoryTimeline(rows, now).upcoming.map((r) => r.kind)).toEqual([
      "hosted",
      "registered",
    ]);
    const pastRows = [
      row("registered", "2026-01-01T00:00:00Z"),
      row("hosted", "2026-01-01T00:00:00Z"),
    ];
    expect(splitHistoryTimeline(pastRows, now).past.map((r) => r.kind)).toEqual([
      "hosted",
      "registered",
    ]);
  });
});

describe("hostedInvolvementLabel", () => {
  it("labels hosts and collaborators, with the creator always Host", () => {
    expect(hostedInvolvementLabel("host", false)).toBe("Host");
    expect(hostedInvolvementLabel("collaborator", true)).toBe("Host");
    expect(hostedInvolvementLabel("collaborator", false)).toBe("Collaborator");
  });
});

describe("eventStatusText", () => {
  it("labels every enum value and passes unknown values through", () => {
    expect(eventStatusText("draft")).toBe("Draft");
    expect(eventStatusText("published")).toBe("Published");
    expect(eventStatusText("cancelled")).toBe("Cancelled");
    expect(eventStatusText("mystery")).toBe("mystery");
  });
});

describe("historyLink", () => {
  const id = "8f14e45f-ceea-467f-a830-a06cf1b89d20";

  it("links published events to their public page", () => {
    expect(historyLink({ id, status: "published" })).toEqual({
      href: `/events/${id}`,
      label: "View event",
    });
  });

  it("links team-only events to the studio manager", () => {
    expect(historyLink({ id, status: "draft" })).toEqual({
      href: "/dashboard/events",
      label: "Open in studio",
    });
    expect(historyLink({ id, status: "cancelled" })).toEqual({
      href: "/dashboard/events",
      label: "Open in studio",
    });
  });

  it("links nothing when RLS hides the event", () => {
    expect(historyLink(null)).toBeNull();
  });
});
