import { originProblem } from "@/lib/media/request";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentUserId, unpublishItem } from "@/lib/media/store";

/**
 * POST /api/media/unpublish — JSON { itemId }.
 * Masters must still be in drafts before any public object is removed;
 * the flow is idempotent and converges on retry (see store.ts).
 */
export async function POST(request: Request) {
  const crossOrigin = originProblem(request);
  if (crossOrigin) return crossOrigin;
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { itemId?: unknown };
  try {
    body = (await request.json()) as typeof body;
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid JSON body");
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  if (typeof body.itemId !== "string" || body.itemId.length === 0) {
    return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  }

  const outcome = await unpublishItem(supabase, uid, body.itemId);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.problem, hint: outcome.hint }, { status: outcome.status });
  }
  return NextResponse.json(outcome);
}

export const runtime = "nodejs";

export const maxDuration = 60;
