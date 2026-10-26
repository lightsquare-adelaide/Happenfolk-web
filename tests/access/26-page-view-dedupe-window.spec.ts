import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  admin,
  anonClient,
  applyRedGuard,
  createEvent,
  createUser,
  guard,
  stackConfig,
  type EventRow,
  type TestUser,
} from "./_harness";

/**
 * Audit A4 (26 October 2026). record_page_view was executable by anon with
 * no de-duplication and no bound, so a loop of RPC calls pushed any
 * published subject to the top of the seven-day view counts that both
 * trending views order by.
 *
 * Migration 20261026000600 bounds it to one row per identity per subject
 * per 30 minutes: auth.uid () for members, a subject-scoped SHA-256 of the
 * proxy client IP + user agent for anonymous callers, with the
 * check-and-insert serialised by a transaction advisory lock so a
 * concurrent burst from one identity cannot slip several rows past the
 * EXISTS check.
 *
 * This is a bound on single-identity flooding, not complete anti-abuse:
 * rotating or spoofed identities still hash differently. What is pinned
 * here is that the mitigation exists, is per subject, expires, and is
 * race-safe.
 */

// Red mode: a zero-length window disables the bound entirely, so every
// repeat call counts again.
guard(
  "26a-dedupe-window-zeroed",
  `create or replace function public.page_view_dedupe_window ()
   returns interval language sql immutable set search_path = ''
   as $guard$ select interval '0 seconds' $guard$;`,
  `create or replace function public.page_view_dedupe_window ()
   returns interval language sql immutable set search_path = ''
   as $guard$ select interval '30 minutes' $guard$;`,
);

// Red mode: the same bound without the advisory lock. A burst from one
// identity then passes the EXISTS check in parallel and writes several
// rows, and the blocked-caller assertion below fails.
guard(
  "26b-page-view-advisory-lock-removed",
  `create or replace function public.record_page_view (
     p_subject_type text, p_subject_id uuid
   ) returns void language plpgsql security definer set search_path = ''
   as $guard$
   declare
     v_ok boolean;
     v_viewer uuid := auth.uid ();
     v_visitor_hash text;
     v_window interval := public.page_view_dedupe_window ();
   begin
     if p_subject_type not in ('event', 'profile', 'portfolio_item') then
       raise exception 'UNKNOWN_SUBJECT_TYPE: %', p_subject_type;
     end if;
     v_ok := case p_subject_type
       when 'event' then exists (select 1 from public.events e
                 where e.id = p_subject_id and e.status = 'published')
       when 'profile' then exists (select 1 from public.profiles p
                 where p.id = p_subject_id and p.published)
       when 'portfolio_item' then exists (select 1 from public.portfolio_items pi
                 where pi.id = p_subject_id and pi.published)
     end;
     if not v_ok then
       raise exception 'SUBJECT_NOT_FOUND_OR_NOT_PUBLISHED';
     end if;
     if v_viewer is null then
       v_visitor_hash := public.page_view_visitor_hash (p_subject_type, p_subject_id);
     end if;
     if v_viewer is not null or v_visitor_hash is not null then
       if exists (
         select 1 from public.page_views pv
         where pv.subject_type = p_subject_type and pv.subject_id = p_subject_id
           and pv.viewed_at > now () - v_window
           and ((v_viewer is not null and pv.viewer_id = v_viewer)
             or (v_viewer is null and pv.visitor_hash = v_visitor_hash))
       ) then
         return;
       end if;
     end if;
     insert into public.page_views (subject_type, subject_id, viewer_id, visitor_hash)
     values (p_subject_type, p_subject_id, v_viewer, v_visitor_hash);
   end;
   $guard$;`,
  `create or replace function public.record_page_view (
     p_subject_type text, p_subject_id uuid
   ) returns void language plpgsql security definer set search_path = ''
   as $guard$
   declare
     v_ok boolean;
     v_viewer uuid := auth.uid ();
     v_visitor_hash text;
     v_window interval := public.page_view_dedupe_window ();
   begin
     if p_subject_type not in ('event', 'profile', 'portfolio_item') then
       raise exception 'UNKNOWN_SUBJECT_TYPE: %', p_subject_type;
     end if;
     v_ok := case p_subject_type
       when 'event' then exists (select 1 from public.events e
                 where e.id = p_subject_id and e.status = 'published')
       when 'profile' then exists (select 1 from public.profiles p
                 where p.id = p_subject_id and p.published)
       when 'portfolio_item' then exists (select 1 from public.portfolio_items pi
                 where pi.id = p_subject_id and pi.published)
     end;
     if not v_ok then
       raise exception 'SUBJECT_NOT_FOUND_OR_NOT_PUBLISHED';
     end if;
     if v_viewer is null then
       v_visitor_hash := public.page_view_visitor_hash (p_subject_type, p_subject_id);
     end if;
     if v_viewer is not null or v_visitor_hash is not null then
       perform pg_advisory_xact_lock (
         hashtextextended (
           coalesce(v_viewer::text, v_visitor_hash) || '|' ||
           p_subject_type || '|' || p_subject_id::text, 0));
       if exists (
         select 1 from public.page_views pv
         where pv.subject_type = p_subject_type and pv.subject_id = p_subject_id
           and pv.viewed_at > now () - v_window
           and ((v_viewer is not null and pv.viewer_id = v_viewer)
             or (v_viewer is null and pv.visitor_hash = v_visitor_hash))
       ) then
         return;
       end if;
     end if;
     insert into public.page_views (subject_type, subject_id, viewer_id, visitor_hash)
     values (p_subject_type, p_subject_id, v_viewer, v_visitor_hash);
   end;
   $guard$;`,
);

const LOCK_WAIT_MS = 1500;

let host: TestUser;
let member: TestUser;
let undoRed: (() => Promise<void>) | null = null;
const extraConnections: pg.Client[] = [];

async function rawConnection(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: stackConfig().dbUrl });
  await client.connect();
  extraConnections.push(client);
  return client;
}

async function viewCount(eventId: string): Promise<number> {
  const { data, error } = await anonClient()
    .from("trending_events")
    .select("view_count")
    .eq("id", eventId)
    .single();
  if (error) throw new Error(`viewCount failed: ${error.message}`);
  return Number(data?.view_count ?? 0);
}

async function recordAnon(eventId: string) {
  return anonClient().rpc("record_page_view", {
    p_subject_type: "event",
    p_subject_id: eventId,
  });
}

beforeAll(async () => {
  undoRed = await applyRedGuard();
  host = await createUser("dedupe-host");
  member = await createUser("dedupe-member");
});

afterAll(async () => {
  await Promise.all(extraConnections.map((c) => c.end().catch(() => {})));
  if (undoRed) await undoRed();
});

describe("audit A4 — page views are bounded per identity, per subject, per window", () => {
  let repeatEvent: EventRow;

  it("counts an anonymous view once and ignores the repeat inside the window", async () => {
    repeatEvent = await createEvent(host, "Dedupe Repeat Study");
    const before = await viewCount(repeatEvent.id);

    const first = await recordAnon(repeatEvent.id);
    expect(first.error).toBeNull();
    expect(await viewCount(repeatEvent.id)).toBe(before + 1);

    for (let i = 0; i < 4; i += 1) {
      const repeat = await recordAnon(repeatEvent.id);
      expect(repeat.error).toBeNull();
    }
    expect(await viewCount(repeatEvent.id)).toBe(before + 1);
  });

  it("is per subject: the same visitor on another event still counts", async () => {
    const other = await createEvent(host, "Dedupe Other Study");
    const before = await viewCount(other.id);
    const rpc = await recordAnon(other.id);
    expect(rpc.error).toBeNull();
    expect(await viewCount(other.id)).toBe(before + 1);
    // The first event is unaffected by activity elsewhere.
    expect(await viewCount(repeatEvent.id)).toBeGreaterThan(0);
  });

  it("bounds a signed-in member's views the same way", async () => {
    const event = await createEvent(host, "Dedupe Member Study");
    const before = await viewCount(event.id);

    const first = await member.client.rpc("record_member_view", {
      p_subject_type: "event",
      p_subject_id: event.id,
    });
    expect(first.error).toBeNull();
    expect(await viewCount(event.id)).toBe(before + 1);

    const second = await member.client.rpc("record_member_view", {
      p_subject_type: "event",
      p_subject_id: event.id,
    });
    expect(second.error).toBeNull();
    expect(await viewCount(event.id)).toBe(before + 1);
  });

  it("counts again once the window has passed", async () => {
    const event = await createEvent(host, "Dedupe Expired Study");
    const a = await admin();
    // A view from before the window: the member's next view is a new one.
    await a.query(
      `insert into public.page_views (subject_type, subject_id, viewer_id, viewed_at)
       values ('event', $1, $2, now () - interval '31 minutes')`,
      [event.id, member.userId],
    );
    const before = await viewCount(event.id);
    expect(before).toBe(1);

    const rpc = await member.client.rpc("record_member_view", {
      p_subject_type: "event",
      p_subject_id: event.id,
    });
    expect(rpc.error).toBeNull();
    expect(await viewCount(event.id)).toBe(before + 1);
  });

  it("serialises a concurrent burst from one identity into a single row", async () => {
    const event = await createEvent(host, "Dedupe Burst Study");
    const before = await viewCount(event.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => recordAnon(event.id)),
    );
    for (const result of results) expect(result.error).toBeNull();
    expect(await viewCount(event.id)).toBe(before + 1);
  });

  it("makes a second concurrent caller wait instead of double-counting", async () => {
    const event = await createEvent(host, "Dedupe Lock Study");
    const a = await rawConnection();
    const b = await rawConnection();

    // A raw connection carries no proxy headers, so both callers are given
    // the same synthetic ones PostgREST would supply. Same IP + user agent
    // means the same subject-scoped visitor hash, which is the advisory
    // lock key: without an identity the recorder has nothing to serialise
    // on (and documents that it then inserts without deduping).
    const headers = JSON.stringify({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "dedupe-lock-probe",
    });

    // A records a view and holds its transaction open: the advisory lock
    // taken inside record_page_view is transaction-scoped, so it is still
    // held here.
    await a.query("begin");
    await a.query("set local role anon");
    await a.query("select set_config('request.headers', $1, true)", [headers]);
    await a.query("select public.record_page_view('event', $1)", [event.id]);

    await b.query("begin");
    await b.query("set local role anon");
    await b.query("select set_config('request.headers', $1, true)", [headers]);
    await b.query(`set local statement_timeout = ${LOCK_WAIT_MS}`);

    let blocked = false;
    try {
      await b.query("select public.record_page_view('event', $1)", [event.id]);
    } catch (err) {
      // 57014 = query_canceled: B waited on A's advisory lock until the
      // timeout. Without the lock B would have returned immediately.
      blocked = (err as { code?: string }).code === "57014";
      if (!blocked) throw err;
    }
    await b.query("rollback").catch(() => {});
    await a.query("commit");

    expect(blocked).toBe(true);
    expect(await viewCount(event.id)).toBe(1);
  });
});
