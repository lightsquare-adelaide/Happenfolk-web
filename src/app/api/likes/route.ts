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
 * POST /api/likes — toggle a member's like on a published event,
 * profile or portfolio item.
 *
 * Body: { subjectType: 'event' | 'profile' | 'portfolio_item', subjectId: uuid }
 * Returns: { ok: true, liked: boolean, likeCount: number }
 *
 * Delegates to public.toggle_like (0009, updated in 20261028200200),
 * which enforces auth, publication, non-hidden status and idempotent
 * insert/delete on public.interactions, then reads the updated public
 * aggregate from public.like_counts.
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
  if (
    !subjectType ||
    !SUBJECT_TYPES.has(subjectType) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)
  ) {
    return NextResponse.json({ error: "INVALID_SUBJECT" }, { status: 400 });
  }

  const { data: liked, error } = await supabase.rpc("toggle_like", {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
  });
  if (error) {
    const status = error.message.includes("NOT_FOUND") ? 404 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const { data: row } = await supabase
    .from("like_counts")
    .select("like_count")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    liked: Boolean(liked),
    likeCount: Number(row?.like_count ?? 0),
  });
}
