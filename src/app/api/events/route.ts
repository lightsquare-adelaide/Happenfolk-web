import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { logApiEvent, LogReason } from "@/lib/log";
import {
  eventCategoryProblem,
  eventDescriptionProblem,
  eventInstantProblem,
  eventLocationProblem,
  eventTimesProblem,
  eventTitleProblem,
  jsonObjectProblem,
  unsupportedFieldProblem,
} from "@/lib/events";

/**
 * POST /api/events — create a DRAFT event hosted by the caller
 * (S5). Deliberately absent: price, capacity, registration and any
 * host transfer. Events keep the database default price of 0 and no
 * surface lets a client change that.
 *
 * Defence layers, in order: same-origin gate (browser mutations),
 * authenticated identity, field allowlist + pure validation rules,
 * then the RLS "members create events they host" policy as the backstop
 * that no route bug can talk past. Error text returned to callers is
 * always one of our friendly problems; database messages are logged by
 * reason code, never echoed.
 */

/** Create fields only — host_id is server-assigned, never client input. */
const CREATE_FIELDS = [
  "title",
  "location",
  "description",
  "category_id",
  "starts_at",
  "ends_at",
] as const;

function badRequest(error: string, route: string, userId: string | null) {
  logApiEvent({ event: "events_create_invalid", route, status: 400, reason: LogReason.invalidRequest, userId });
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: Request) {
  const route = "/api/events";
  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "events_create_denied", route, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "events_create_denied", route, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON", route, user.id);
  }
  const objectProblem = jsonObjectProblem(parsed);
  if (objectProblem) return badRequest(objectProblem, route, user.id);
  const body = parsed as Record<string, unknown>;

  const unsupported = unsupportedFieldProblem(body, CREATE_FIELDS);
  if (unsupported) return badRequest(unsupported, route, user.id);

  const titleProblem = eventTitleProblem(body.title);
  if (titleProblem) return badRequest(titleProblem, route, user.id);

  const locationProblem = eventLocationProblem(body.location);
  if (locationProblem) return badRequest(locationProblem, route, user.id);

  const descriptionProblem = eventDescriptionProblem(body.description);
  if (descriptionProblem) return badRequest(descriptionProblem, route, user.id);

  const categoryProblem = eventCategoryProblem(body.category_id);
  if (categoryProblem) return badRequest(categoryProblem, route, user.id);

  const startProblem = eventInstantProblem(body.starts_at);
  if (startProblem) return badRequest(`Start: ${startProblem.charAt(0).toLowerCase()}${startProblem.slice(1)}`, route, user.id);
  if (body.ends_at !== undefined && body.ends_at !== null && typeof body.ends_at !== "string") {
    return badRequest("End time must be text or null", route, user.id);
  }
  const endsAt = typeof body.ends_at === "string" && body.ends_at !== "" ? body.ends_at : null;
  const timesProblem = eventTimesProblem(body.starts_at as string, endsAt);
  if (timesProblem) return badRequest(timesProblem, route, user.id);

  let categoryId: number | null = null;
  if (body.category_id !== undefined && body.category_id !== null) {
    categoryId = Number(body.category_id);
    const { data: category } = await supabase
      .from("categories")
      .select("id")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category) return badRequest("Unknown category", route, user.id);
  }

  const { data: event, error } = await supabase
    .from("events")
    .insert({
      host_id: user.id,
      title: (body.title as string).trim(),
      location: (body.location as string).trim(),
      description: typeof body.description === "string" ? body.description : null,
      category_id: categoryId,
      starts_at: body.starts_at as string,
      ends_at: endsAt,
      status: "draft",
    })
    .select("id, title, status, location, starts_at")
    .single();
  if (error || !event) {
    logApiEvent({
      event: "events_create_failed",
      route,
      status: error?.code === "42501" ? 403 : 500,
      reason: error?.code === "42501" ? LogReason.ownershipDenied : LogReason.upstreamError,
      userId: user.id,
    });
    if (error?.code === "42501") {
      return NextResponse.json({ error: "Only the signed-in artist can host a new event" }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not create the event" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, event }, { status: 201 });
}
