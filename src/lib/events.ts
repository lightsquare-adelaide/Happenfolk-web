/**
 * Event rules, framework-free pure functions (unit-testable).
 *
 * Scope S5 only: name, location, date/time, optional description and
 * category, optional cover, roster. There is deliberately NO price,
 * registration or payment surface here — events keep the database
 * default price_cents of 0 and no route or form may set it.
 *
 * TIME POLICY. The product speaks Australia/Adelaide wall time to the
 * artist and stores unambiguous UTC instants. `adelaideWallTimeToInstant`
 * does the conversion with the real IANA zone rules (via Intl), never a
 * fixed +09:30 offset and never the server's own timezone. Daylight
 * saving creates two edge classes and both are rejected explicitly:
 * a spring-forward time that does not exist, and an autumn time that
 * occurs twice (ambiguous). Callers must not guess an instant for
 * either; the UI asks the artist to pick a different time.
 */

/** Adelaide is the product's single event timezone (brief S5). */
export const EVENT_TIMEZONE = "Australia/Adelaide";

export const EVENT_STATUSES = ["draft", "published", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Field limits shared by create/edit validation and the UI. */
export const EVENT_TITLE_MAX = 120;
export const EVENT_LOCATION_MAX = 200;
export const EVENT_DESCRIPTION_MAX = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * The status state machine: draft -> published -> cancelled, strictly
 * linear. Cancelled is terminal — republishing a cancelled event is
 * rejected.
 */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return (
    (from === "draft" && to === "published") ||
    (from === "published" && to === "cancelled")
  );
}

/** Human message for illegal transitions (the UI shows it verbatim). */
export function transitionProblem(from: EventStatus, to: EventStatus): string | null {
  if (canTransition(from, to)) return null;
  if (from === to) return null; // no-op change, not an error
  if (from === "cancelled") return "A cancelled event cannot be republished";
  if (from === "draft") return "A draft can only be published; it cannot be cancelled directly";
  return "The status does not allow this transition";
}

/** Name: required, trimmed, bounded. A missing field reads as missing, not as a type error. */
export function eventTitleProblem(value: unknown): string | null {
  if (value === null || value === undefined) return "Event name is required";
  if (typeof value !== "string") return "Event name must be text";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Event name is required";
  if (trimmed.length > EVENT_TITLE_MAX) return `Event name is at most ${EVENT_TITLE_MAX} characters`;
  return null;
}

/** Location: required (S5), trimmed, bounded. Missing or empty is a failure, never a clear. */
export function eventLocationProblem(value: unknown): string | null {
  if (value === null || value === undefined) return "Event location is required";
  if (typeof value !== "string") return "Event location must be text";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Event location is required";
  if (trimmed.length > EVENT_LOCATION_MAX) return `Event location is at most ${EVENT_LOCATION_MAX} characters`;
  return null;
}

/** Description: optional (null clears it), bounded when present. */
export function eventDescriptionProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "Description must be text";
  if (value.length > EVENT_DESCRIPTION_MAX) return `Description is at most ${EVENT_DESCRIPTION_MAX} characters`;
  return null;
}

/**
 * API timestamps must be unambiguous instants: a full ISO-8601
 * date-time WITH an explicit offset (Z or ±hh:mm). Naive local strings
 * ("2026-01-01T10:00") are rejected because their meaning depends on
 * whoever parses them; the Adelaide helper below is the only sanctioned
 * way to turn wall time into an instant.
 *
 * The regex alone is not enough: Date.parse happily rolls impossible
 * components over ("2027-02-30T09:00:00Z" parses as 2 March, hour 24
 * parses as the next day). Every component is range-checked and the
 * day is checked against the real month length before Date.parse runs.
 */
const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function eventInstantProblem(value: unknown): string | null {
  if (typeof value !== "string") return "Date and time must be text";
  const m = ISO_INSTANT_RE.exec(value);
  if (!m) {
    return "Date and time must be a full ISO-8601 instant with a timezone offset";
  }
  const notReal = "Date and time is not a real calendar moment";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12) return notReal;
  // Days-in-month via day 0 of the NEXT month; handles leap years.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return notReal;
  if (hour > 23) return "Hour must be between 00 and 23";
  if (minute > 59 || second > 59) return notReal;
  if (Number.isNaN(Date.parse(value))) return notReal;
  return null;
}

/** Times: both instants valid, end not before start when present. */
export function eventTimesProblem(startsAt: string, endsAt: string | null): string | null {
  const startProblem = eventInstantProblem(startsAt);
  if (startProblem) return `Start: ${startProblem.charAt(0).toLowerCase()}${startProblem.slice(1)}`;
  const start = Date.parse(startsAt);
  if (endsAt !== null && endsAt !== undefined && endsAt !== "") {
    const endProblem = eventInstantProblem(endsAt);
    if (endProblem) return `End: ${endProblem.charAt(0).toLowerCase()}${endProblem.slice(1)}`;
    if (Date.parse(endsAt) < start) return "End time cannot be before the start time";
  }
  return null;
}

/** Category ids are smallint identity values (0002): 1..32767. */
export function eventCategoryProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 32767) {
    return "Invalid category";
  }
  return null;
}

/** Problem message when a parsed request body is not a plain object. */
export function jsonObjectProblem(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Request body must be a JSON object";
  }
  return null;
}

/**
 * Field allowlist. Unknown keys are REJECTED, not silently dropped, so
 * a client sending host_id or price_cents learns immediately that the
 * field is not writable here (host takeover attempts must never look
 * like they half-succeeded).
 */
export function unsupportedFieldProblem(
  body: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) return `Unsupported field: ${key}`;
  }
  return null;
}

// ---------------- Australia/Adelaide wall time -> UTC instant ----------------

export type AdelaideConversion =
  | { ok: true; iso: string; offsetMinutes: number }
  | {
      ok: false;
      kind: "invalid_date" | "invalid_time" | "nonexistent" | "ambiguous";
      problem: string;
    };

function adelaideWallParts(instantMs: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  // en-US with hour12:false can render midnight as hour 24.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return { year: parts.year, month: parts.month, day: parts.day, hour, minute: parts.minute };
}

/** The zone's real offset (minutes east of UTC) at one instant. */
function zoneOffsetMinutesAt(instantMs: number): number {
  const p = adelaideWallParts(instantMs);
  const wallAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((wallAsUtcMs - instantMs) / 60_000);
}

/**
 * Converts one Adelaide wall-clock reading (YYYY-MM-DD + HH:mm) into a
 * UTC instant using the actual zone rules — daylight saving included,
 * independent of the server or browser timezone.
 *
 * Explicit edge policy (leader-approved):
 * - a spring-forward local time that never exists -> kind "nonexistent";
 * - an autumn local time that occurs twice -> kind "ambiguous"
 *   (rejected rather than silently picking an occurrence);
 * - impossible calendar dates (2026-02-30) -> kind "invalid_date".
 */
export function adelaideWallTimeToInstant(date: string, time: string): AdelaideConversion {
  const invalidDate: AdelaideConversion = {
    ok: false, kind: "invalid_date", problem: "Choose a real calendar date",
  };
  const invalidTime: AdelaideConversion = {
    ok: false, kind: "invalid_time", problem: "Choose a time as HH:MM (24-hour)",
  };
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dm) return invalidDate;
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!tm) return invalidTime;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return invalidDate;
  if (hour > 23 || minute > 59) return invalidTime;

  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  // Reject impossible dates: Date.UTC rolls 2026-02-30 over into March.
  const rolled = new Date(wallAsUtcMs);
  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() !== month - 1 ||
    rolled.getUTCDate() !== day
  ) {
    return invalidDate;
  }

  // Candidate offsets: probe the zone at the wall reading treated as
  // UTC and one day either side, so a DST transition inside the window
  // contributes both of its offsets.
  const offsets = new Set<number>([
    zoneOffsetMinutesAt(wallAsUtcMs - 86_400_000),
    zoneOffsetMinutesAt(wallAsUtcMs),
    zoneOffsetMinutesAt(wallAsUtcMs + 86_400_000),
  ]);

  const candidates = new Set<number>();
  for (const offset of offsets) {
    const instantMs = wallAsUtcMs - offset * 60_000;
    // Keep only self-consistent readings: at the candidate instant the
    // zone must actually be on the offset that produced it.
    if (zoneOffsetMinutesAt(instantMs) === offset) candidates.add(instantMs);
  }

  if (candidates.size === 0) {
    return {
      ok: false,
      kind: "nonexistent",
      problem:
        "That local time does not exist in Adelaide (clocks jump forward for daylight saving). Choose a time after the gap.",
    };
  }
  if (candidates.size > 1) {
    return {
      ok: false,
      kind: "ambiguous",
      problem:
        "That local time happens twice in Adelaide when daylight saving ends. Choose a time before or after the repeated hour.",
    };
  }
  const [instantMs] = [...candidates];
  return {
    ok: true,
    iso: new Date(instantMs).toISOString(),
    offsetMinutes: zoneOffsetMinutesAt(instantMs),
  };
}
