import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanupUsers, insertDraftItem, listOwnerOrder } from "./_harness";
import {
  appBase, buildFixtures, cleanupFixtures, createUser, sessionCookieHeader,
  startApp, uploadRequest, type FixtureSet, type TestUser,
} from "../media/_harness";
import { apiCall, expectFriendly } from "../events/_http";

/**
 * Whole-item deletion against REAL storage: the published happy path
 * must leave zero objects in drafts AND media (verified in
 * storage.objects, not just missing DB rows), strangers get a friendly
 * 404 with data intact, and forced failures prove the retry contract:
 *
 *   - a row-delete failure AFTER the private bytes are gone keeps the
 *     metadata (unpublished) and the retry completes — missing
 *     originals are never required to be downloadable again;
 *   - a real storage.objects DELETE failure keeps every row AND byte,
 *     and the retry after the probe is removed completes.
 *
 * Both probes are scoped local fixture triggers (this spec's item/user
 * ids only), restored in finally.
 */

let app: { close: () => Promise<void> } | null = null;
let fixtures: FixtureSet;
const createdUsers: TestUser[] = [];
let owner: TestUser;
let stranger: TestUser;
let ownerCookie = "";
let strangerCookie = "";

beforeAll(async () => {
  app = await startApp();
  fixtures = await buildFixtures();
  owner = await createUser("portfolio-delete-owner");
  createdUsers.push(owner);
  stranger = await createUser("portfolio-delete-stranger");
  createdUsers.push(stranger);
  ownerCookie = await sessionCookieHeader(owner.email, owner.password);
  strangerCookie = await sessionCookieHeader(stranger.email, stranger.password);
}, 600_000);

afterAll(async () => {
  try {
    await cleanupUsers(createdUsers);
  } finally {
    try {
      if (fixtures) await cleanupFixtures(fixtures.dir);
    } finally {
      if (app) await app.close();
      app = null;
    }
  }
});

async function uploadWithAlt(name: string, alt: string, itemId?: string) {
  const res = await fetch(
    `${appBase()}/api/media/upload`,
    uploadRequest(ownerCookie, name, fixtures.gpsJpg, { itemId, altText: alt }),
  );
  const body = (await res.json()) as { itemId?: string; assetId?: string };
  expect(res.status).toBe(201);
  return body;
}

async function deleteItemApi(cookie: string | undefined, itemId: string, origin?: string) {
  return apiCall("DELETE", `/api/portfolio/items/${itemId}`, { cookie, origin });
}

/** Real storage state: object names under the user's folder in both buckets. */
async function storedObjects(uid: string): Promise<string[]> {
  const db = await admin();
  const { rows } = await db.query(
    "select bucket_id, name from storage.objects where name like $1 order by bucket_id, name",
    [`${uid}/%`],
  );
  return rows.map((r) => `${r.bucket_id}:${r.name}`);
}

async function itemRow(itemId: string) {
  const db = await admin();
  const { rows } = await db.query(
    "select id, published from public.portfolio_items where id = $1", [itemId],
  );
  return rows[0] as { id: string; published: boolean } | undefined;
}

async function mediaRowCount(itemId: string): Promise<number> {
  const db = await admin();
  const { rows } = await db.query(
    "select count(*)::int as n from public.media_assets where portfolio_item_id = $1", [itemId],
  );
  return rows[0].n;
}

describe("published deletion removes every owned byte and row", () => {
  it("deletes a published work end to end", async () => {
    const up = await uploadWithAlt("published.jpg", "A published work");
    const itemId = up.itemId!;
    const publish = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(publish.status).toBe(200);
    expect((await storedObjects(owner.userId)).length).toBeGreaterThan(0);

    const deleted = await deleteItemApi(ownerCookie, itemId);
    expect(deleted.status).toBe(200);
    expect(deleted.json).toMatchObject({ ok: true, deleted: true });

    expect(await itemRow(itemId)).toBeUndefined();
    expect(await mediaRowCount(itemId)).toBe(0);
    // ACTUAL storage emptiness — not just missing DB rows.
    expect(await storedObjects(owner.userId)).toEqual([]);
  });

  it("refuses strangers and anonymous callers, data untouched", async () => {
    const up = await uploadWithAlt("guarded.jpg", "Guarded work");
    const itemId = up.itemId!;

    const strangerRes = await deleteItemApi(strangerCookie, itemId);
    expectFriendly(strangerRes, 404, "not yours");
    const anonRes = await deleteItemApi(undefined, itemId);
    expectFriendly(anonRes, 401, "Sign in first");
    const evilOrigin = await deleteItemApi(ownerCookie, itemId, "https://evil.example");
    expectFriendly(evilOrigin, 403, "Cross-origin");
    const badId = await deleteItemApi(ownerCookie, "not-a-uuid");
    expectFriendly(badId, 400, "Invalid work identifier");

    expect(await itemRow(itemId)).toBeDefined();
    expect((await storedObjects(owner.userId)).length).toBeGreaterThan(0);

    // Cleanup for later tests.
    const deleted = await deleteItemApi(ownerCookie, itemId);
    expect(deleted.status).toBe(200);
  });
});

describe("retry after a row-delete failure (bytes already gone)", () => {
  it("keeps metadata, stays recoverable and completes on retry", async () => {
    const up = await uploadWithAlt("rowfail.jpg", "Row failure probe");
    const itemId = up.itemId!;
    const publish = await apiCall("POST", "/api/media/publish", { cookie: ownerCookie, body: { itemId } });
    expect(publish.status).toBe(200);

    const db = await admin();
    await db.query(`
      create function public.probe_block_portfolio_row_delete () returns trigger
      language plpgsql as $$ begin raise exception 'PROBE_ROW_DELETE_MARKER'; end; $$;
      create trigger trg_probe_block_portfolio_row_delete
        before delete on public.portfolio_items
        for each row when (old.id = '${itemId}'::uuid)
        execute function public.probe_block_portfolio_row_delete ();
    `);
    try {
      const blocked = await deleteItemApi(ownerCookie, itemId);
      expect(blocked.status).toBe(500);
      const message = blocked.json?.error ?? "";
      expect(message).toContain("retry");
      expect(JSON.stringify(blocked.json)).not.toContain("PROBE_ROW_DELETE_MARKER");

      // The lifecycle got as far as the bytes: public objects AND the
      // private original are gone, the flag was flipped, the metadata
      // and media rows remain for the retry.
      expect(await storedObjects(owner.userId)).toEqual([]);
      const row = await itemRow(itemId);
      expect(row).toBeDefined();
      expect(row!.published).toBe(false);
      expect(await mediaRowCount(itemId)).toBeGreaterThan(0);

      // Retry with the probe removed: the item is unpublished and its
      // originals are NOT downloadable anymore — deletion must still
      // succeed without requiring the bytes back.
      await db.query("drop trigger trg_probe_block_portfolio_row_delete on public.portfolio_items");
      const retried = await deleteItemApi(ownerCookie, itemId);
      expect(retried.status, JSON.stringify(retried.json)).toBe(200);
      expect(await itemRow(itemId)).toBeUndefined();
      expect(await mediaRowCount(itemId)).toBe(0);
      expect(await storedObjects(owner.userId)).toEqual([]);
    } finally {
      await db.query("drop trigger if exists trg_probe_block_portfolio_row_delete on public.portfolio_items").catch(() => {});
      await db.query("drop function if exists public.probe_block_portfolio_row_delete ()").catch(() => {});
    }
  });
});

describe("retry after a real storage removal failure", () => {
  it("keeps rows AND bytes, and completes on retry", async () => {
    const up = await uploadWithAlt("storagefail.jpg", "Storage failure probe");
    const itemId = up.itemId!;
    const before = await storedObjects(owner.userId);
    expect(before.length).toBeGreaterThan(0);

    const db = await admin();
    await db.query(`
      create function public.probe_block_storage_delete () returns trigger
      language plpgsql as $$ begin raise exception 'PROBE_STORAGE_DELETE_MARKER'; end; $$;
      create trigger trg_probe_block_storage_delete
        before delete on storage.objects
        for each row when (old.bucket_id = 'drafts' and old.name like '${owner.userId}/%')
        execute function public.probe_block_storage_delete ();
    `);
    try {
      const blocked = await deleteItemApi(ownerCookie, itemId);
      expect(blocked.status).toBe(500);
      const raw = JSON.stringify(blocked.json);
      expect(raw).not.toContain("PROBE_STORAGE_DELETE_MARKER");
      expect(blocked.json?.error ?? "").toContain("retry");

      // Nothing was lost: the row, the media metadata and the actual
      // private bytes all survive the failed attempt.
      expect(await itemRow(itemId)).toBeDefined();
      expect(await mediaRowCount(itemId)).toBeGreaterThan(0);
      expect(await storedObjects(owner.userId)).toEqual(before);
    } finally {
      await db.query("drop trigger if exists trg_probe_block_storage_delete on storage.objects").catch(() => {});
      await db.query("drop function if exists public.probe_block_storage_delete ()").catch(() => {});
    }

    const retried = await deleteItemApi(ownerCookie, itemId);
    expect(retried.status, JSON.stringify(retried.json)).toBe(200);
    expect(await itemRow(itemId)).toBeUndefined();
    expect(await storedObjects(owner.userId)).toEqual([]);
  });
});

describe("deleting a work never disturbs the rest of the list", () => {
  it("leaves sibling order deterministic after deletion", async () => {
    const a = await insertDraftItem(owner.client, owner.userId, "Sibling A");
    const b = await insertDraftItem(owner.client, owner.userId, "Sibling B");
    const c = await insertDraftItem(owner.client, owner.userId, "Sibling C");

    const deleted = await deleteItemApi(ownerCookie, b);
    expect(deleted.status).toBe(200);

    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.id)).toEqual([a, c]);
    // A move after deletion still works through the RPC (dense renormalization).
    const moved = await owner.client.rpc("move_portfolio_item", { p_item_id: c, p_direction: "up" });
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);
    const after = await listOwnerOrder(owner.client, owner.userId);
    expect(after.map((r) => r.id)).toEqual([c, a]);
    expect(after.map((r) => r.position)).toEqual([0, 1]);
  });
});
