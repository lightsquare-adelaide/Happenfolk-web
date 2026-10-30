import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { LogReason, logApiEvent } from "@/lib/log";
import { parseItemCreate } from "@/lib/portfolio-management";

const ROUTE = "/api/portfolio/items";

/**
 * POST /api/portfolio/items — JSON { title, description?, year?, tags? }.
 * Creates the caller's own draft work. Position is NOT accepted from
 * the client: the database allocates it atomically (append under the
 * owner-profile lock, migration 20261026000800), so concurrent creates
 * can never collide or inject into the middle of the list.
 *
 * media_kind starts as 'image' for every managed draft and is only an
 * advisory legacy field: the #20 store pipeline pins it when IT creates
 * the draft, and the upload route may pin it on an existing item's
 * FIRST media — but nothing keeps it in sync afterwards. Rendering and
 * playback decisions must read the actual media_assets.content_type,
 * not this column.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    logApiEvent({ event: "portfolio_create_denied", route: ROUTE, status: 403, reason: LogReason.ownershipDenied, userId: null });
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    logApiEvent({ event: "portfolio_create_denied", route: ROUTE, status: 401, reason: LogReason.unauthenticated, userId: null });
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = parseItemCreate(raw);
  if (!parsed.ok) {
    logApiEvent({ event: "portfolio_create_denied", route: ROUTE, status: 400, reason: LogReason.invalidRequest, userId: user.id });
    return NextResponse.json({ error: parsed.problem }, { status: 400 });
  }
  const metadata = parsed.value;

  const { data: item, error } = await supabase
    .from("portfolio_items")
    .insert({
      profile_id: user.id,
      title: metadata.title,
      description: metadata.description,
      year: metadata.year,
      tags: metadata.tags,
      media_kind: "image",
    })
    .select("id, title, description, year, tags, position")
    .single();
  if (error || !item) {
    logApiEvent({ event: "portfolio_create_failed", route: ROUTE, status: 500, reason: LogReason.upstreamError, userId: user.id });
    return NextResponse.json({ error: "Could not create the work; please retry" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, item }, { status: 201 });
}

export const runtime = "nodejs";
