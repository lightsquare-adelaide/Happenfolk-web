import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/request-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SubjectType = "event" | "profile" | "portfolio_item";
const SUBJECT_TYPES: ReadonlySet<SubjectType> = new Set([
  "event",
  "profile",
  "portfolio_item",
]);

/**
 * POST /api/admin/set-hidden — staff-only toggle of `is_hidden` on an
 * event, profile or portfolio item.
 *
 * Body: { subjectType, subjectId, hidden: boolean }
 * Enforced in the database by `public.admin_set_hidden` (20261028200200),
 * which checks `public.is_staff()` against `public.admin_staff`.
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
  const subjectType = body?.subjectType as SubjectType | undefined;
  const subjectId = typeof body?.subjectId === "string" ? body.subjectId : "";
  const hidden = typeof body?.hidden === "boolean" ? body.hidden : null;

  if (
    !subjectType ||
    !SUBJECT_TYPES.has(subjectType) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId) ||
    hidden === null
  ) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { error } = await supabase.rpc("admin_set_hidden", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_hidden: hidden,
  });

  if (error) {
    const status = error.message.includes("ADMIN_REQUIRED")
      ? 403
      : error.message.includes("SUBJECT_NOT_FOUND")
        ? 404
        : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true, hidden });
}
