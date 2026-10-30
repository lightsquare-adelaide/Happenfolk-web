import { beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createUser,
  insertDraftItem,
  listOwnerOrder,
  moveItem,
  type TestUser,
} from "./_harness";

/**
 * Whole-list normalization inside move_portfolio_item. Tied positions
 * can only come from direct legacy writes, so — per lead ruling — the
 * tie fixture uses the local admin connection. A pair-only repair is
 * wrong with >=3 tied rows: moving B up in [A,B,C] all at position 7
 * must yield [B,A,C], never [B,C,A], and unmoved rows keep their
 * relative order.
 */

let owner: TestUser;
let a: string;
let b: string;
let c: string;
let d: string;

beforeAll(async () => {
  owner = await createUser("portfolio-ties");
  a = await insertDraftItem(owner.client, owner.userId, "A");
  b = await insertDraftItem(owner.client, owner.userId, "B");
  c = await insertDraftItem(owner.client, owner.userId, "C");
  d = await insertDraftItem(owner.client, owner.userId, "D");
});

/** Admin-only fixture: force every one of the owner's items onto one position. */
async function tieAllPositions(position: number): Promise<void> {
  const db = await admin();
  await db.query("update public.portfolio_items set position = $1 where profile_id = $2", [
    position,
    owner.userId,
  ]);
}

async function orderIds(): Promise<string[]> {
  return (await listOwnerOrder(owner.client, owner.userId)).map((r) => r.id);
}

describe("tied legacy rows normalize under the caller profile lock", () => {
  it("moving B up in [A,B,C,D] all at 7 yields [B,A,C,D] with dense positions", async () => {
    await tieAllPositions(7);
    const moved = await moveItem(owner.client, b, "up");
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);

    expect(await orderIds()).toEqual([b, a, c, d]);
    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it("moving C down among ties keeps every unmoved row's relative order", async () => {
    await tieAllPositions(7);
    // Deterministic tie order is (position, created_at, id) → A,B,C,D.
    const moved = await moveItem(owner.client, c, "down");
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);

    expect(await orderIds()).toEqual([a, b, d, c]);
    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it("normalizes gaps and duplicates from direct legacy writes before any swap", async () => {
    const db = await admin();
    // A=5, B=5 (duplicate), C=99 (gap), D=99.
    await db.query("update public.portfolio_items set position = 5 where id in ($1, $2)", [a, b]);
    await db.query("update public.portfolio_items set position = 99 where id in ($1, $2)", [c, d]);

    // Edge no-op still normalizes: D is last, "down" returns false but
    // the whole list must now be dense and unique.
    const moved = await moveItem(owner.client, d, "down");
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(false);

    const order = await listOwnerOrder(owner.client, owner.userId);
    expect(order.map((r) => r.id)).toEqual([a, b, c, d]);
    expect(order.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });
});
