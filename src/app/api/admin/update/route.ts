import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/update — staff-only correction of text fields on a
 * profile, portfolio item or event.
 *
 * Body:
 *   { subjectType: 'profile' | 'portfolio_item' | 'event',
 *     subjectId: uuid,
 *     fields: Record<string, string | null> }
 *
 * Delegates to public.admin_update_{profile,item,event} (20261028200200),
 * each gated by public.is_staff().
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "CROSS_ORIGIN_REQUEST" }, { status: 403 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const subjectType = typeof body?.subjectType === "string" ? body.subjectType : "";
  const subjectId = typeof body?.subjectId === "string" ? body.subjectId : "";
  const fields =
    body?.fields && typeof body.fields === "object" && !Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>)
      : null;

  if (!subjectType || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId) || !fields) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const allowedFields: Record<string, string[]> = {
    profile: ["display_name", "bio"],
    portfolio_item: ["title", "description"],
    event: ["title", "description", "location"],
  };
  const allowed = Object.hasOwn(allowedFields, subjectType) ? allowedFields[subjectType] : undefined;
  if (!allowed || Object.keys(fields).length === 0 || Object.entries(fields).some(
    ([key, value]) => !allowed.includes(key) || (value !== null && typeof value !== "string"),
  )) {
    return NextResponse.json({ error: "INVALID_FIELDS" }, { status: 400 });
  }
  // Null or missing means leave unchanged, as defined by the database RPCs.
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  let r: { error: { message: string } | null };
  if (subjectType === "profile") {
    r = await supabase.rpc("admin_update_profile", {
      p_member_id: subjectId,
      p_display_name: str(fields.display_name),
      p_bio: str(fields.bio),
    });
  } else if (subjectType === "portfolio_item") {
    r = await supabase.rpc("admin_update_item", {
      p_item_id: subjectId,
      p_title: str(fields.title),
      p_description: str(fields.description),
    });
  } else if (subjectType === "event") {
    r = await supabase.rpc("admin_update_event", {
      p_event_id: subjectId,
      p_title: str(fields.title),
      p_description: str(fields.description),
      p_location: str(fields.location),
    });
  } else {
    return NextResponse.json(
      { error: "UNKNOWN_SUBJECT_TYPE" },
      { status: 400 },
    );
  }

  if (r.error) {
    const status = r.error.message.includes("ADMIN_REQUIRED")
      ? 403
      : r.error.message.includes("SUBJECT_NOT_FOUND")
        ? 404
        : 400;
    return NextResponse.json({ error: r.error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
