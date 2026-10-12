/** Dashboard display rules, kept framework-free so they can be unit tested. */

const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  payment_failed: "Payment failed",
  cancelled: "Cancelled",
};

/** Readable label for an event_registrations.status value (FR-REG-08 wording). */
export function registrationStatusLabel(status: string): string {
  return REGISTRATION_STATUS_LABELS[status] ?? status;
}

// Happenfolk serves South Australia, so event times show in Adelaide time.
const eventDate = new Intl.DateTimeFormat("en-AU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Australia/Adelaide",
});

export function formatEventDate(iso: string): string {
  return eventDate.format(new Date(iso));
}

/** Upcoming events soonest first, then past events most recent first. */
export function orderEvents<T extends { starts_at: string }>(events: T[], now: Date): T[] {
  const time = (e: T) => new Date(e.starts_at).getTime();
  const nowMs = now.getTime();
  const upcoming = events.filter((e) => time(e) >= nowMs).sort((a, b) => time(a) - time(b));
  const past = events.filter((e) => time(e) < nowMs).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}
