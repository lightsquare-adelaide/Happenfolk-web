import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, createPortfolioItem, createUser, type TestUser } from "./_harness";
import { withPg } from "../compliance/_harness";

describe("Task B staff privilege and aggregate boundaries", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let itemId: string;
  beforeAll(async () => {
    owner = await createUser("b-boundary-owner");
    stranger = await createUser("b-boundary-stranger");
    expect((await owner.client.from("profiles").update({ published: true, category_id: 1 }).eq("id", owner.userId)).error).toBeNull();
    itemId = (await createPortfolioItem(owner, "Boundary work", true)).id;
  });
  afterAll(async () => {
    await withPg(async (db) => {
      if (itemId) {
        await db.query("delete from public.page_views_monthly where subject_id=$1", [itemId]);
        await db.query("delete from public.interactions where subject_id=$1", [itemId]);
      }
      for (const user of [owner, stranger]) if (user) await db.query("delete from auth.users where id=$1", [user.userId]);
    });
  });

  it("denies self-enrolment as staff and direct hiding or unhiding", async () => {
    expect((await owner.client.from("admin_staff").insert({ member_id: owner.userId })).error).not.toBeNull();
    expect((await owner.client.rpc("is_staff")).data).toBe(false);
    expect((await owner.client.from("profiles").update({ is_hidden: true }).eq("id", owner.userId)).error).not.toBeNull();
    await withPg(async (db) => {
      await db.query("update public.profiles set is_hidden=true where id=$1", [owner.userId]);
    });
    expect((await owner.client.from("profiles").update({ is_hidden: false }).eq("id", owner.userId)).error).not.toBeNull();
    expect((await owner.client.from("profiles").select("is_hidden").eq("id", owner.userId).single()).data?.is_hidden).toBe(true);
    expect((await stranger.client.from("admin_staff").select("member_id")).data).toEqual([]);
    expect((await anonClient().from("admin_staff").select("member_id")).data).toEqual([]);
  });

  it("hides like/monthly totals and rejects direct likes when the owning profile is hidden", async () => {
    await withPg(async (db) => {
      await db.query("insert into public.page_views_monthly(subject_type,subject_id,view_month,view_count) values ('portfolio_item',$1,'2026-01-01',5)", [itemId]);
      await db.query("insert into public.interactions(member_id,subject_type,subject_id) values ($1,'portfolio_item',$2)", [owner.userId, itemId]);
    });
    for (const table of ["like_counts", "page_views_monthly"]) {
      const result = await anonClient().from(table).select("subject_id").eq("subject_id", itemId);
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    const like = await stranger.client.from("interactions").insert({ member_id: stranger.userId, subject_type: "portfolio_item", subject_id: itemId });
    expect(like.error).not.toBeNull();
    expect((await stranger.client.from("interactions").select("subject_id").eq("subject_id", itemId)).data).toEqual([]);
  });
});
