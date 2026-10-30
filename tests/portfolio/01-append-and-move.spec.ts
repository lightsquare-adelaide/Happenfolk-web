import { beforeAll, describe, expect, it } from "vitest";
import {
  createUser,
  insertDraftItem,
  listOwnerOrder,
  moveItem,
  type TestUser,
} from "./_harness";
import { createDraftItem } from "../../src/lib/media/store";

/**
 * Append allocation and moves through the real stack: every insert path
 * (the #20 store pipeline and direct client inserts, with or without a
 * supplied position) appends under the owner-profile lock, and
 * move_portfolio_item swaps neighbors or reports an edge no-op.
 * Metadata limits are asserted at the DB trust boundary, not just in
 * the pure rules.
 */

let owner: TestUser;

beforeAll(async () => {
  owner = await createUser("portfolio-order-owner");
});

describe("append allocation (#20 direct-insert compatible)", () => {
  it("appends every insert in arrival order, including the store pipeline path", async () => {
    // The exact #20 path: createDraftItem inserts {profile_id, title,
    // media_kind} with no position.
    const viaStore = await createDraftItem(owner.client, owner.userId, "image");
    expect(viaStore.ok).toBe(true);
    if (!viaStore.ok) return;

    const direct = await insertDraftItem(owner.client, owner.userId, "Direct Draft");

    // A direct write that SUPPLIES a position must still append — the
    // trigger owns allocation, so nobody can inject into the middle.
    const smuggled = await owner.client
      .from("portfolio_items")
      .insert({ profile_id: owner.userId, title: "Smuggled", media_kind: "image", position: 0 })
      .select("id")
      .single();
    expect(smuggled.error).toBeNull();

    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.id)).toEqual([viaStore.itemId, direct, smuggled.data!.id]);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("keeps positions unique and dense across interleaved inserts", async () => {
    for (const title of ["Fourth", "Fifth"]) {
      await insertDraftItem(owner.client, owner.userId, title);
    }
    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(order.map((r) => r.id)).size).toBe(order.length);
  });
});

describe("move_portfolio_item", () => {
  let mover: TestUser;
  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    mover = await createUser("portfolio-mover");
    a = await insertDraftItem(mover.client, mover.userId, "A");
    b = await insertDraftItem(mover.client, mover.userId, "B");
    c = await insertDraftItem(mover.client, mover.userId, "C");
  });

  it("moves an item up by swapping with its neighbor", async () => {
    const moved = await moveItem(mover.client, c, "up");
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);
    const order = await listOwnerOrder(mover.client, mover.userId);
    expect(order.map((r) => r.id)).toEqual([a, c, b]);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it("moves an item down", async () => {
    const moved = await moveItem(mover.client, a, "down");
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);
    const order = await listOwnerOrder(mover.client, mover.userId);
    expect(order.map((r) => r.id)).toEqual([c, a, b]);
  });

  it("reports an edge no-op with false and leaves data untouched", async () => {
    const firstUp = await moveItem(mover.client, c, "up"); // c is first
    expect(firstUp.error).toBeNull();
    expect(firstUp.data).toBe(false);

    const lastDown = await moveItem(mover.client, b, "down"); // b is last
    expect(lastDown.error).toBeNull();
    expect(lastDown.data).toBe(false);

    const order = await listOwnerOrder(mover.client, mover.userId);
    expect(order.map((r) => r.id)).toEqual([c, a, b]);
  });

  it("rejects an invalid direction", async () => {
    const bad = await mover.client.rpc("move_portfolio_item", {
      p_item_id: a,
      p_direction: "sideways",
    });
    expect(bad.error).not.toBeNull();
    expect(bad.error!.message).toMatch(/invalid direction/);
  });

  it("rejects a non-owned or missing item with 42501 and changes nothing", async () => {
    const randomId = "3f2b8c1e-9d4a-4f6b-8c2e-1a0b9d8e7f60";
    const missing = await moveItem(mover.client, randomId, "up");
    expect(missing.error).not.toBeNull();
    expect(missing.error!.code).toBe("42501");

    const order = await listOwnerOrder(mover.client, mover.userId);
    expect(order.map((r) => r.id)).toEqual([c, a, b]);
  });
});

describe("metadata trust boundary", () => {
  let meta: TestUser;

  beforeAll(async () => {
    meta = await createUser("portfolio-metadata");
  });

  it("enforces the year range check on insert and update", async () => {
    const low = await meta.client
      .from("portfolio_items")
      .insert({ profile_id: meta.userId, title: "Old", media_kind: "image", year: 1849 });
    expect(low.error).not.toBeNull();

    const high = await meta.client
      .from("portfolio_items")
      .insert({ profile_id: meta.userId, title: "Future", media_kind: "image", year: 2101 });
    expect(high.error).not.toBeNull();

    const ok = await meta.client
      .from("portfolio_items")
      .insert({ profile_id: meta.userId, title: "In Range", media_kind: "image", year: 2026 })
      .select("id, year")
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data!.year).toBe(2026);

    const badUpdate = await meta.client
      .from("portfolio_items")
      .update({ year: 1700 })
      .eq("id", ok.data!.id);
    expect(badUpdate.error).not.toBeNull();
  });

  it("normalizes tags on write exactly like the pure rule", async () => {
    const created = await meta.client
      .from("portfolio_items")
      .insert({
        profile_id: meta.userId,
        title: "Tagged",
        media_kind: "image",
        tags: [
          "  Oil  ",
          "oil",
          "",
          "x".repeat(31),
          ...Array.from({ length: 14 }, (_, i) => `tag${i}`),
        ],
      })
      .select("id, tags")
      .single();
    expect(created.error).toBeNull();
    const tags = created.data!.tags as string[];
    // lowercase+trim, dedupe, empty and >30-char dropped, capped at 12.
    expect(tags[0]).toBe("oil");
    expect(tags).toHaveLength(12);
    expect(tags.every((t) => t === t.trim().toLowerCase() && t.length >= 1 && t.length <= 30)).toBe(true);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("coerces NULL tags to the empty array and allows clearing", async () => {
    const created = await meta.client
      .from("portfolio_items")
      .insert({ profile_id: meta.userId, title: "No Tags", media_kind: "image", tags: null as unknown as string[] })
      .select("id, tags")
      .single();
    expect(created.error).toBeNull();
    expect(created.data!.tags).toEqual([]);

    const cleared = await meta.client
      .from("portfolio_items")
      .update({ tags: [] })
      .eq("id", created.data!.id)
      .select("tags")
      .single();
    expect(cleared.error).toBeNull();
    expect(cleared.data!.tags).toEqual([]);
  });

  it("keeps title/description/media_kind/published updatable for the owner", async () => {
    const created = await meta.client
      .from("portfolio_items")
      .insert({ profile_id: meta.userId, title: "Editable", media_kind: "image" })
      .select("id")
      .single();
    expect(created.error).toBeNull();
    const updated = await meta.client
      .from("portfolio_items")
      .update({ title: "Renamed", description: "A study", media_kind: "video", year: 1999 })
      .eq("id", created.data!.id)
      .select("title, description, media_kind, year")
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data).toMatchObject({
      title: "Renamed",
      description: "A study",
      media_kind: "video",
      year: 1999,
    });
  });

  it("refuses direct position edits (column grant excludes position)", async () => {
    const created = await meta.client
      .from("portfolio_items")
      .insert({ profile_id: meta.userId, title: "Ordered", media_kind: "image" })
      .select("id, position")
      .single();
    expect(created.error).toBeNull();

    const before = await listOwnerOrder(meta.client, meta.userId);
    const attempt = await meta.client
      .from("portfolio_items")
      .update({ position: -50 })
      .eq("id", created.data!.id);
    // Postgres rejects the write outright: no privilege on the column.
    expect(attempt.error).not.toBeNull();

    const after = await listOwnerOrder(meta.client, meta.userId);
    expect(after.map((r) => r.position)).toEqual(before.map((r) => r.position));
  });
});
