import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { logApiEvent, LogReason } from "@/lib/log";
import {
  EVENT_STATUSES,
  eventCategoryProblem,
  eventDescriptionProblem,
  eventInstantProblem,
  eventLocationProblem,
  eventTitleProblem,
  eventTimesProblem,
  isUuid,
  jsonObjectProblem,
  transitionProblem,
  unsupportedFieldProblem,
  type EventStatus,
} from "@/lib/events";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * THE COLLABORATION GATE — the single place that decides "may this
 * user edit this event". It is MEMBERSHIP, not ownership: the creator
 * is on the roster via the 0005 trigger, so `is_event_collaborator`
 * covers the host AND invited collaborators through ONE check. Never
 * replace this with `event.host_id === user.id` (invited collaborators
 * would lose ordinary editing) and never add a parallel
 * "host OR collaborator" branch (two copies of one rule drift apart).
 * The RLS "collaborators update events" policy stays underneath as an
 * independent backstop; tests/events asserts both layers by data state.
 */
async function requireCollaborator(supabase: SupabaseClient, uid: string, eventId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_event_collaborator", {
    p_event: eventId,
    p_member: uid,
  });
  return data === true;
}

/** Roster management and deletion are HOST-only (is_event_host). */
async function requireHost(supabase: SupabaseClient, uid: string, eventId: string): Promise<boolean> {
  const { data } = await supabase.rpc("is_event_host", { p_event: eventId, p_member: uid });
  return data === true;
}

/** Ordinary edits only — no host_id, price_cents, capacity or raw row pass-through. */
const EDIT_FIELDS = [
  "title",
  "location",
  "description",
  "category_id",
  "starts_at",
  "ends_at",
  "status",
] as const;

type EventUpdate = {
  title?: string;
  location?: string;
  description?: string | null;
  category_id?: number | null;
  starts_at?: string;
  ends_at?: string | null;
  status?: EventStatus;
};

const NOT_FOUND = "Event not found or you are not a collaborator";

/** PATCH /api/events/[id] — JSON, partial; every listed collaborator may edit. */
export async function PATCH(request: Request, context: RouteContext) {
  const route = "/api/events/[id]";
  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "events_edit_denied", route, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_edit_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid event identifier" }, { status: 400 });
  }
  if (!(await requireCollaborator(supabase, user.id, id))) {
    logApiEvent({ event: "events_edit_denied", route, status: 404, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  const { data: current } = await supabase
    .from("events")
    .select("title, location, description, category_id, starts_at, ends_at, status, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const objectProblem = jsonObjectProblem(parsed);
  if (objectProblem) return NextResponse.json({ error: objectProblem }, { status: 400 });
  const body = parsed as Record<string, unknown>;

  const unsupported = unsupportedFieldProblem(body, EDIT_FIELDS);
  if (unsupported) return NextResponse.json({ error: unsupported }, { status: 400 });

  const problem = (message: string) => {
    logApiEvent({ event: "events_edit_invalid", route, status: 400, reason: LogReason.invalidRequest, userId: user.id });
    return NextResponse.json({ error: message }, { status: 400 });
  };

  const update: EventUpdate = {};

  if (body.title !== undefined) {
    const titleProblem = eventTitleProblem(body.title);
    if (titleProblem) return problem(titleProblem);
    update.title = (body.title as string).trim();
  }
  // Location is required for the whole life of an event: null/blank is
  // a validation failure, never a clear.
  if (body.location !== undefined) {
    const locationProblem = eventLocationProblem(body.location);
    if (locationProblem) return problem(locationProblem);
    update.location = (body.location as string).trim();
  }
  if (body.description !== undefined) {
    const descriptionProblem = eventDescriptionProblem(body.description);
    if (descriptionProblem) return problem(descriptionProblem);
    update.description = typeof body.description === "string" ? body.description : null;
  }
  if (body.category_id !== undefined) {
    const categoryProblem = eventCategoryProblem(body.category_id);
    if (categoryProblem) return problem(categoryProblem);
    if (body.category_id === null) {
      update.category_id = null;
    } else {
      const categoryId = Number(body.category_id);
      const { data: category } = await supabase
        .from("categories")
        .select("id")
        .eq("id", categoryId)
        .maybeSingle();
      if (!category) return problem("Unknown category");
      update.category_id = categoryId;
    }
  }
  if (body.starts_at !== undefined || body.ends_at !== undefined) {
    if (body.starts_at !== undefined) {
      const startProblem = eventInstantProblem(body.starts_at);
      if (startProblem) return problem(`Start: ${startProblem.charAt(0).toLowerCase()}${startProblem.slice(1)}`);
    }
    if (body.ends_at !== undefined && body.ends_at !== null && typeof body.ends_at !== "string") {
      return problem("End time must be text or null");
    }
    const startsAt = body.starts_at !== undefined ? (body.starts_at as string) : (current.starts_at as string);
    const endsAt =
      body.ends_at === undefined
        ? (current.ends_at as string | null)
        : typeof body.ends_at === "string" && body.ends_at !== ""
          ? body.ends_at
          : null;
    const timesProblem = eventTimesProblem(startsAt, endsAt);
    if (timesProblem) return problem(timesProblem);
    if (body.starts_at !== undefined) update.starts_at = startsAt;
    if (body.ends_at !== undefined) update.ends_at = endsAt;
  }

  // Status transitions follow the state machine; cancelled is terminal.
  // Re-sending the CURRENT status is an idempotent no-op (rules allow
  // it), not a field write — handled below the update check.
  let statusNoop = false;
  if (body.status !== undefined) {
    const to = body.status;
    if (typeof to !== "string" || !EVENT_STATUSES.includes(to as EventStatus)) {
      return problem("Unknown event status");
    }
    const from = current.status as EventStatus;
    if (to === from) {
      statusNoop = true;
    } else {
      const machineProblem = transitionProblem(from, to as EventStatus);
      if (machineProblem) return problem(machineProblem);
      if (to === "published" && !current.location && !update.location) {
        return problem("Add an event location before publishing");
      }
      update.status = to as EventStatus;
    }
  }

  if (Object.keys(update).length === 0) {
    if (statusNoop) {
      // Idempotent repeat of the current status: answer 200 with the
      // current event and write nothing, so a retried publish/cancel
      // never turns into a bogus validation failure or a CAS bump.
      const { data: unchanged } = await supabase
        .from("events")
        .select("id, title, location, description, category_id, starts_at, ends_at, status")
        .eq("id", id)
        .maybeSingle();
      return NextResponse.json({ ok: true, event: unchanged });
    }
    return problem("No fields to update");
  }

  // Optimistic concurrency: the write only lands if the row still
  // carries the updated_at we validated against (trg_events_touch_updated_at
  // bumps it on every change). Two collaborators editing from the same
  // stale read can therefore not both write: the loser gets a friendly
  // 409 and reloads instead of silently overwriting the other's edit
  // or publishing over a cancellation.
  const { data: applied, error } = await supabase
    .from("events")
    .update(update)
    .eq("id", id)
    .eq("updated_at", current.updated_at)
    .select("id");
  if (error) {
    logApiEvent({ event: "events_edit_failed", route, status: 500, reason: LogReason.upstreamError, userId: user.id });
    return NextResponse.json({ error: "Could not update the event" }, { status: 500 });
  }
  if (!applied || applied.length === 0) {
    // Zero rows is either the version check firing or a genuine RLS
    // refusal. A fresh read tells them apart: a visible row whose
    // updated_at moved is a conflict; anything else stays the denial
    // path.
    const { data: now } = await supabase
      .from("events")
      .select("id, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (now && now.updated_at !== current.updated_at) {
      logApiEvent({ event: "events_edit_conflict", route, status: 409, reason: LogReason.ownershipDenied, userId: user.id });
      return NextResponse.json(
        { error: "The event changed while you were editing. Reload and try again." },
        { status: 409 },
      );
    }
    // Membership passed but the policy/grant refused the write —
    // nothing was changed. Report the denial without database text.
    logApiEvent({ event: "events_edit_denied", route, status: 403, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: "Could not update the event" }, { status: 403 });
  }

  const { data: after } = await supabase
    .from("events")
    .select("id, title, location, description, category_id, starts_at, ends_at, status")
    .eq("id", id)
    .maybeSingle();
  return NextResponse.json({ ok: true, event: after });
}

/**
 * DELETE /api/events/[id] — host-only. Collaborators (including other
 * organisers) get the same not-found shape as strangers; the RLS
 * "hosts delete own events" policy enforces this a second time.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const route = "/api/events/[id]";
  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "events_delete_denied", route, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_delete_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid event identifier" }, { status: 400 });
  }
  if (!(await requireHost(supabase, user.id, id))) {
    logApiEvent({ event: "events_delete_denied", route, status: 404, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: "Event not found or only its organiser can delete it" }, { status: 404 });
  }

  // Caller-scoped, best-effort cover cleanup. cover_path is a
  // client-writable column at the grant level, so this is NOT a
  // proven server-owned association; we only ever attempt storage
  // removal for a path that sits under the caller's own folder, which
  // is exactly what the 0007 storage policies would allow anyway. A
  // collaborator's cover under a different folder is left in place
  // rather than removed through a privileged side door.
  const { data: before } = await supabase.from("events").select("cover_path").eq("id", id).maybeSingle();

  const { data: applied, error } = await supabase.from("events").delete().eq("id", id).select("id");
  if (error) {
    logApiEvent({ event: "events_delete_failed", route, status: 500, reason: LogReason.upstreamError, userId: user.id });
    return NextResponse.json({ error: "Could not delete the event" }, { status: 500 });
  }
  if (!applied || applied.length === 0) {
    logApiEvent({ event: "events_delete_denied", route, status: 403, reason: LogReason.ownershipDenied, userId: user.id });
    return NextResponse.json({ error: "Could not delete the event" }, { status: 403 });
  }

  if (before?.cover_path && typeof before.cover_path === "string" && before.cover_path.startsWith(`${user.id}/`)) {
    const removed = await supabase.storage.from("covers").remove([before.cover_path]);
    if (removed.error) {
      logApiEvent({ event: "events_cover_cleanup_failed", route, status: 200, reason: LogReason.storageError, userId: user.id });
    }
  }
  return NextResponse.json({ ok: true });
}
