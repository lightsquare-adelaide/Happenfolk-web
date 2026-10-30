/** Pure grouping and sorting rules for the participation-history page.
 *
 * A signed-in member's history blends two relationships with an event:
 * hosting/collaborating (event_collaborators + events) and registering
 * (event_registrations). The page owns the queries; these framework-free
 * rules own the timeline so they stay unit-testable (W2). */

export type HistoryKind = "hosted" | "registered";

export type HistoryRow = {
  kind: HistoryKind;
  /**
   * Event start as an ISO timestamp. Null when RLS hides the event from
   * this member (for example a registration on an event that was later
   * cancelled), so its timing cannot be known.
   */
  startsAt: string | null;
};

export type HistoryTimeline<T extends HistoryRow> = {
  upcoming: T[];
  past: T[];
  unavailable: T[];
};

// Stable tie-break: hosted rows sort ahead of registered rows with the
// same start time; Array#sort keeps the original order beyond that.
const KIND_ORDER: Record<HistoryKind, number> = { hosted: 0, registered: 1 };

/**
 * Split rows into "Upcoming" (soonest first) and "Past" most recent
 * first, mirroring orderEvents in dashboard.ts. An event that starts
 * exactly at `now` counts as upcoming. Rows whose event is no longer
 * visible to the member sink into `unavailable`.
 */
export function splitHistoryTimeline<T extends HistoryRow>(
  rows: T[],
  now: Date,
): HistoryTimeline<T> {
  const time = (row: T): number => (row.startsAt == null ? 0 : Date.parse(row.startsAt));
  const byKind = (a: T, b: T): number => KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  const visible = rows.filter((row) => row.startsAt != null);
  const nowMs = now.getTime();
  return {
    upcoming: visible.filter((row) => time(row) >= nowMs)
      .sort((a, b) => time(a) - time(b) || byKind(a, b)),
    past: visible.filter((row) => time(row) < nowMs)
      .sort((a, b) => time(b) - time(a) || byKind(a, b)),
    unavailable: rows.filter((row) => row.startsAt == null),
  };
}

/**
 * Involvement label for a roster row. The event creator always shows as
 * Host even if the roster role text says otherwise.
 */
export function hostedInvolvementLabel(role: string, isSelfHosted: boolean): string {
  return role === "host" || isSelfHosted ? "Host" : "Collaborator";
}

const EVENT_STATUS_TEXT: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
};

/** Readable label for an events.status value. */
export function eventStatusText(status: string): string {
  return EVENT_STATUS_TEXT[status] ?? status;
}

export type HistoryEventSnapshot = { id: string; status: string } | null;

/**
 * Link target for a history row: the public event page when the event
 * is published, the studio event manager for the member's own team
 * events (drafts and cancelled events are team-only), and nothing when
 * RLS hides the event — its details must not leak.
 */
export function historyLink(
  event: HistoryEventSnapshot,
): { href: string; label: string } | null {
  if (!event) return null;
  if (event.status === "published") return { href: `/events/${event.id}`, label: "View event" };
  return { href: "/dashboard/events", label: "Open in studio" };
}
