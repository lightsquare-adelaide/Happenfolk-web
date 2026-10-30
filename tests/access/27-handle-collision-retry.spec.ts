import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  applyRedGuard,
  createUser,
  guard,
  stackConfig,
  type TestUser,
} from "./_harness";

/**
 * Audit A7 (26 October 2026). handle_new_user derived a free handle with
 * "look for a free suffix, then insert". Two sign-ups racing for the same
 * base handle both saw the same free candidate; the loser hit
 * profiles_handle_key and the unique_violation escaped the auth.users
 * insert trigger, so the sign-up failed with a raw 500 instead of getting
 * a suffixed handle.
 *
 * Migration 20261026000400 keeps the deterministic pre-check and adds a
 * retry on a unique_violation OF THE HANDLE (any other constraint is
 * re-raised unchanged). The race is forced here the way tests/payments/02
 * forces the capacity race: transaction A holds the contested handle in an
 * uncommitted update, so the signing-up caller's pre-check cannot see it
 * and its INSERT blocks on the unique index. A is only committed once a
 * waiter is actually observed on A's transaction id, so the test cannot
 * pass by accidentally missing the race.
 */

// Red mode: 0003's original body — pre-check only, no retry. The loser of
// the race surfaces the unique violation and the sign-up assertion fails.
guard(
  "27-handle-collision-retry-removed",
  `create or replace function public.handle_new_user ()
   returns trigger language plpgsql security definer set search_path = ''
   as $guard$
   declare
     base text;
     candidate text;
     suffix int := 0;
   begin
     base := lower(
       coalesce(
         nullif(new.raw_user_meta_data ->> 'handle', ''),
         split_part(coalesce(new.email, ''), '@', 1),
         'member'
       ));
     base := regexp_replace(base, '[^a-z0-9_]+', '_', 'g');
     base := regexp_replace(base, '^_+|_+$', '');
     if length(base) < 3 then
       base := 'member_' || substr(replace(new.id::text, '-', ''), 1, 8);
     end if;
     base := substr(base, 1, 30);
     candidate := base;
     while exists (select 1 from public.profiles p where p.handle = candidate) loop
       suffix := suffix + 1;
       candidate := substr(base, 1, 30 - length(suffix::text)) || suffix::text;
     end loop;
     insert into public.profiles (id, handle, display_name, account_kind, category_id)
     values (
       new.id, candidate,
       coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
                initcap(replace(candidate, '_', ' '))),
       case new.raw_user_meta_data ->> 'account_kind'
         when 'organisation' then 'organisation'::public.account_kind
         else 'individual'::public.account_kind
       end,
       case when new.raw_user_meta_data ->> 'category_id' ~ '^\\d+$'
         then (new.raw_user_meta_data ->> 'category_id')::smallint
         else null end);
     return new;
   end;
   $guard$;`,
  `create or replace function public.handle_new_user ()
   returns trigger language plpgsql security definer set search_path = ''
   as $guard$
   declare
     base text;
     candidate text;
     suffix int := 0;
     v_constraint text;
   begin
     base := lower(
       coalesce(
         nullif(new.raw_user_meta_data ->> 'handle', ''),
         split_part(coalesce(new.email, ''), '@', 1),
         'member'
       ));
     base := regexp_replace(base, '[^a-z0-9_]+', '_', 'g');
     base := regexp_replace(base, '^_+|_+$', '');
     if length(base) < 3 then
       base := 'member_' || substr(replace(new.id::text, '-', ''), 1, 8);
     end if;
     base := substr(base, 1, 30);
     candidate := base;
     loop
       while exists (select 1 from public.profiles p where p.handle = candidate) loop
         suffix := suffix + 1;
         candidate := substr(base, 1, 30 - length(suffix::text)) || suffix::text;
       end loop;
       begin
         insert into public.profiles (id, handle, display_name, account_kind, category_id)
         values (
           new.id, candidate,
           coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
                    initcap(replace(candidate, '_', ' '))),
           case new.raw_user_meta_data ->> 'account_kind'
             when 'organisation' then 'organisation'::public.account_kind
             else 'individual'::public.account_kind
           end,
           case when new.raw_user_meta_data ->> 'category_id' ~ '^\\d+$'
             then (new.raw_user_meta_data ->> 'category_id')::smallint
             else null end);
         exit;
       exception
         when unique_violation then
           get stacked diagnostics v_constraint = constraint_name;
           if v_constraint is distinct from 'profiles_handle_key' then
             raise;
           end if;
           suffix := suffix + 1;
           if suffix > 1000 then
             raise exception 'HANDLE_EXHAUSTED: could not derive a free handle for this account';
           end if;
           candidate := substr(base, 1, 30 - length(suffix::text)) || suffix::text;
       end;
     end loop;
     return new;
   end;
   $guard$;`,
);

// Unique per run: the handle this test contests stays in the database
// afterwards (the blocker keeps it), so a fixed value would collide with
// the previous run's row and the fixture would fail before the race even
// started. Shape must satisfy ^[a-z0-9_]{3,30}$.
const RACE_HANDLE = `race_x_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const BLOCKER_WAIT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let blocker: TestUser;
let undoRed: (() => Promise<void>) | null = null;
const connections: pg.Client[] = [];

async function rawConnection(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: stackConfig().dbUrl });
  await client.connect();
  connections.push(client);
  return client;
}

beforeAll(async () => {
  undoRed = await applyRedGuard();
  blocker = await createUser("handle-race-blocker");
});

afterAll(async () => {
  await Promise.all(connections.map((c) => c.end().catch(() => {})));
  if (undoRed) await undoRed();
});

describe("audit A7 — concurrent sign-ups for one handle both succeed", () => {
  it(
    "gives the loser of the race a suffixed handle instead of a failure",
    async () => {
      const holder = await rawConnection();
      const observer = await rawConnection();

      // Hold the contested handle in an uncommitted transaction. The
      // signing-up caller's existence pre-check cannot see it, but the
      // unique index can, so its INSERT waits on this transaction.
      await holder.query("begin");
      await holder.query(
        "update public.profiles set handle = $1 where id = $2",
        [RACE_HANDLE, blocker.userId],
      );
      const { rows: xidRows } = await holder.query(
        "select pg_current_xact_id()::text as xid",
      );
      const xid = xidRows[0].xid as string;

      const { url, anonKey } = stackConfig();
      const signUpClient = createClient(url, anonKey, {
        auth: { persistSession: false },
      });
      const pending = signUpClient.auth.signUp({
        email: `handle-race-${Date.now()}@access.test`,
        password: "pw-handle-race-ok",
        options: { data: { handle: RACE_HANDLE } },
      });

      // Commit only once a waiter is provably queued on THIS transaction,
      // so the test cannot green-light itself by missing the race.
      let sawWaiter = false;
      const deadline = Date.now() + BLOCKER_WAIT_MS;
      while (Date.now() < deadline) {
        const waiting = await observer.query(
          `select count(*)::int as n from pg_locks
            where locktype = 'transactionid' and transactionid = $1::xid
              and not granted`,
          [xid],
        );
        if ((waiting.rows[0].n as number) > 0) {
          sawWaiter = true;
          break;
        }
        await sleep(25);
      }
      await holder.query("commit");

      expect(sawWaiter, "the concurrent insert never blocked — race not exercised").toBe(true);

      const result = await pending;
      expect(result.error).toBeNull();
      expect(result.data.user).not.toBeNull();

      const userId = result.data.user?.id as string;
      const { data: profile, error } = await signUpClient
        .from("profiles")
        .select("handle")
        .eq("id", userId)
        .single();
      expect(error).toBeNull();

      // Both accounts exist, neither shares a handle, and the second one
      // got the deterministic suffix rather than an error.
      expect(profile?.handle).not.toBe(RACE_HANDLE);
      expect(String(profile?.handle)).toMatch(new RegExp(`^${RACE_HANDLE}\\d+$`));
      const { rows: both } = await observer.query(
        `select handle from public.profiles where handle like $1 order by handle`,
        [`${RACE_HANDLE}%`],
      );
      expect(both.map((r) => r.handle)).toEqual([RACE_HANDLE, `${RACE_HANDLE}1`]);
    },
    60_000,
  );
});
