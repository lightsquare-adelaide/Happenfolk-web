import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createUser,
  insertDraftItem,
  listOwnerOrder,
  moveItem,
  type TestUser,
} from "./_harness";

/**
 * Ownership at the trust boundary. A stranger is refused by the RPC
 * (42501, no owner parameter exists to impersonate) and by RLS on
 * direct writes; every denial is asserted by reading the victim's data
 * state back, never by a status code alone.
 */

let victim: TestUser;
let stranger: TestUser;
let v1: string;
let v2: string;

beforeAll(async () => {
  victim = await createUser("portfolio-victim");
  stranger = await createUser("portfolio-stranger");
  v1 = await insertDraftItem(victim.client, victim.userId, "Victim One");
  v2 = await insertDraftItem(victim.client, victim.userId, "Victim Two");
});

async function victimOrderIds(): Promise<string[]> {
  const order = await listOwnerOrder(victim.client, victim.userId);
  return order.map((r) => r.id);
}

describe("cross-owner move refusal", () => {
  it("refuses a stranger's RPC move with 42501 and leaves the order unchanged", async () => {
    const attempt = await moveItem(stranger.client, v1, "down");
    expect(attempt.error).not.toBeNull();
    expect(attempt.error!.code).toBe("42501");
    expect(attempt.error!.message).toMatch(/not owned/);
    expect(await victimOrderIds()).toEqual([v1, v2]);
  });

  it("refuses anonymous callers", async () => {
    const anon = anonClient();
    const attempt = await anon.rpc("move_portfolio_item", { p_item_id: v1, p_direction: "down" });
    expect(anon.auth.getUser()).toBeDefined();
    expect(attempt.error).not.toBeNull();
    expect(await victimOrderIds()).toEqual([v1, v2]);
  });

  it("refuses the victim's own move of a FOREIGN item id", async () => {
    const foreignItem = await insertDraftItem(stranger.client, stranger.userId, "Stranger Work");
    const attempt = await moveItem(victim.client, foreignItem, "down");
    expect(attempt.error).not.toBeNull();
    expect(attempt.error!.code).toBe("42501");
    const strangerOrder = await listOwnerOrder(stranger.client, stranger.userId);
    expect(strangerOrder.map((r) => r.id)).toEqual([foreignItem]);
  });
});

describe("direct-write boundary", () => {
  it("gives a stranger's title update zero rows under RLS (data state unchanged)", async () => {
    const attempt = await stranger.client
      .from("portfolio_items")
      .update({ title: "Plagiarised" })
      .eq("id", v1)
      .select("id");
    // RLS hides the row: no error, no rows touched.
    expect(attempt.error).toBeNull();
    expect(attempt.data).toEqual([]);

    const { data } = await victim.client
      .from("portfolio_items")
      .select("title")
      .eq("id", v1)
      .single();
    expect(data!.title).toBe("Victim One");
  });

  it("refuses position edits for EVERY authenticated user (column grant excludes position)", async () => {
    const before = await victimOrderIds();
    const attempt = await victim.client
      .from("portfolio_items")
      .update({ position: 99 })
      .eq("id", v1);
    expect(attempt.error).not.toBeNull();
    expect(await victimOrderIds()).toEqual(before);
  });

  it("refuses profile_id reassignment (column grant excludes profile_id)", async () => {
    const attempt = await victim.client
      .from("portfolio_items")
      .update({ profile_id: stranger.userId })
      .eq("id", v1);
    expect(attempt.error).not.toBeNull();
    const { data } = await victim.client
      .from("portfolio_items")
      .select("profile_id")
      .eq("id", v1)
      .single();
    expect(data!.profile_id).toBe(victim.userId);
  });
});
