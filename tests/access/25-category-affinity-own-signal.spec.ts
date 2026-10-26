import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  type EventRow,
  type TestUser,
} from "./_harness";

/**
 * Audit A3 (26 October 2026). category_affinity is a security_invoker view
 * over two signal branches. The likes branch works (interactions has an
 * "own rows" policy); the page_views branch could never return a row,
 * because 0007 gives page_views RLS with ZERO policies and an invoker view
 * reads as the caller. Every member's view signal was therefore 0 and the
 * recommended feeds degraded to plain trending.
 *
 * Migration 20261026000500 moves that branch behind a SECURITY DEFINER
 * aggregate pinned to auth.uid (). This file pins all three properties the
 * design has to keep: the view signal is non-zero for the member who
 * looked, nobody else's affinity is readable through it, and raw page_views
 * rows stay unreadable.
 */

// Red mode: the definer aggregate without its viewer_id pin — everybody's
// views land in the caller's own affinity, so the "B has no signal for this
// category" assertion fails.
guard(
  "25a-affinity-signal-not-scoped-to-caller",
  `create or replace function public.member_category_view_signal ()
   returns table (category_id smallint, view_count integer)
   language sql stable security definer set search_path = '' as $guard$
     select s.category_id, count(*)::integer
     from (
       select coalesce(e.category_id, p.category_id, op.category_id) as category_id
       from public.page_views pv
       left join public.events e
         on pv.subject_type = 'event' and e.id = pv.subject_id
       left join public.profiles p
         on pv.subject_type = 'profile' and p.id = pv.subject_id
       left join public.portfolio_items pi
         on pv.subject_type = 'portfolio_item' and pi.id = pv.subject_id
       left join public.profiles op on op.id = pi.profile_id
       where pv.viewer_id is not null
     ) s
     where s.category_id is not null
     group by s.category_id
   $guard$;`,
  `create or replace function public.member_category_view_signal ()
   returns table (category_id smallint, view_count integer)
   language sql stable security definer set search_path = '' as $guard$
     select s.category_id, count(*)::integer
     from (
       select coalesce(e.category_id, p.category_id, op.category_id) as category_id
       from public.page_views pv
       left join public.events e
         on pv.subject_type = 'event' and e.id = pv.subject_id
       left join public.profiles p
         on pv.subject_type = 'profile' and p.id = pv.subject_id
       left join public.portfolio_items pi
         on pv.subject_type = 'portfolio_item' and pi.id = pv.subject_id
       left join public.profiles op on op.id = pi.profile_id
       where pv.viewer_id = auth.uid ()
     ) s
     where s.category_id is not null
     group by s.category_id
   $guard$;`,
);

// Red mode: the view stops being security_invoker, so it reads every
// member's likes as its owner and the "no other member's rows" assertion
// fails.
guard(
  "25b-affinity-view-not-invoker",
  `alter view public.category_affinity set (security_invoker = false);`,
  `alter view public.category_affinity set (security_invoker = true);`,
);

let viewer: TestUser;
let other: TestUser;
let host: TestUser;
let event: EventRow;
let categoryId: number;
let undoRed: (() => Promise<void>) | null = null;

type AffinityRow = { member_id: string; category_id: number; affinity: number };

async function affinityOf(client: TestUser["client"]): Promise<AffinityRow[]> {
  const { data, error } = await client
    .from("category_affinity")
    .select("member_id, category_id, affinity");
  if (error) throw new Error(`category_affinity read failed: ${error.message}`);
  return (data ?? []) as AffinityRow[];
}

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("affinity-host");
  viewer = await createUser("affinity-viewer");
  other = await createUser("affinity-bystander");

  const { data, error } = await anonClient()
    .from("categories")
    .select("id")
    .order("sort_order")
    .limit(1);
  if (error || !data?.[0]) throw new Error(`category fixture failed: ${error?.message}`);
  categoryId = data[0].id as number;

  event = await createEvent(host, "Affinity Study Gig");
  const categorised = await host.client
    .from("events")
    .update({ category_id: categoryId })
    .eq("id", event.id)
    .select("id, category_id")
    .single();
  if (categorised.error) throw new Error(`event category fixture failed: ${categorised.error.message}`);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("audit A3 — category_affinity carries the caller's own view signal", () => {
  it("scores a logged-in view of a categorised event at 1 point", async () => {
    expect(await affinityOf(viewer.client)).toHaveLength(0);

    const view = await viewer.client.rpc("record_member_view", {
      p_subject_type: "event",
      p_subject_id: event.id,
    });
    expect(view.error).toBeNull();

    const rows = await affinityOf(viewer.client);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ member_id: viewer.userId, category_id: categoryId });
    expect(Number(rows[0].affinity)).toBe(1);
  });

  it("adds the like signal on top of the view signal", async () => {
    const liked = await viewer.client.rpc("toggle_like", {
      p_subject_type: "event",
      p_subject_id: event.id,
    });
    expect(liked.error).toBeNull();
    expect(liked.data).toBe(true);

    const rows = await affinityOf(viewer.client);
    expect(rows).toHaveLength(1);
    // 3 points per like (0009) + 1 point for the view recorded above.
    expect(Number(rows[0].affinity)).toBe(4);
  });

  it("shows a member who looked at nothing no signal at all", async () => {
    const rows = await affinityOf(other.client);
    expect(rows.filter((r) => r.category_id === categoryId)).toHaveLength(0);
    expect(rows.some((r) => r.member_id === viewer.userId)).toBe(false);
  });

  it("keeps raw page_views rows unreadable while the aggregate works", async () => {
    for (const client of [anonClient(), viewer.client, other.client]) {
      const raw = await client.from("page_views").select("id, subject_id, viewer_id");
      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
    }

    // An anonymous caller has no uid, so the definer aggregate answers
    // with zero rows: the view is empty (or refused outright), never
    // somebody else's affinity.
    const anon = await anonClient()
      .from("category_affinity")
      .select("member_id, category_id, affinity");
    if (anon.error) {
      expect(anon.error.message).toMatch(/permission denied/i);
    } else {
      expect(anon.data).toHaveLength(0);
    }
  });
});
