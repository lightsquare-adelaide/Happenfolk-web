import { originProblem } from "@/lib/media/request";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentUserId, publishItem } from "@/lib/media/store";

/**
 * POST /api/media/publish — JSON { itemId, altText? }.
 * Derivatives go to the public bucket first; the published flag flips
 * only after storage holds the public state (see store.ts).
 */
export async function POST(request: Request) {
  const crossOrigin = originProblem(request);
  if (crossOrigin) return crossOrigin;
  const supabase = await createSupabaseServerClient();
  const uid = await currentUserId(supabase);
  if (!uid) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  let body: { itemId?: unknown; altText?: unknown };
  try {
    body = (await request.json()) as typeof body;
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid JSON body");
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  if (typeof body.itemId !== "string" || body.itemId.length === 0) {
    return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
  }

  const outcome = await publishItem(supabase, uid, body.itemId, {
    altText: typeof body.altText === "string" ? body.altText : undefined,
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.problem, hint: outcome.hint }, { status: outcome.status });
  }
  return NextResponse.json(outcome);
}

export const runtime = "nodejs";

export const maxDuration = 60;
