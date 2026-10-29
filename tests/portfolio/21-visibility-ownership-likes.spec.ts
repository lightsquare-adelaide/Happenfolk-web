import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortfolioItem } from "../access/_harness";
import { createUser, sessionCookieHeader, type TestUser } from "../auth/_harness";
import { withPg } from "../compliance/_harness";
import { startTaskApp, taskBase } from "../compliance/_server";

describe("Task B public work details, likes and staff endpoints on the real server", () => {
  let owner: TestUser;
  let viewer: TestUser;
  let staff: TestUser;
  let ownerCookie: string;
  let viewerCookie: string;
  let staffCookie: string;
  let itemId: string;
  let draftId: string;
  let app: Awaited<ReturnType<typeof startTaskApp>> | undefined;

  beforeAll(async () => {
    owner = await createUser("b-work-owner");
    viewer = await createUser("b-work-viewer");
    staff = await createUser("b-work-staff");
    for (const user of [owner, viewer, staff]) {
      expect((await user.client.from("profiles").update({ category_id: 1, published: true }).eq("id", user.userId)).error).toBeNull();
    }
    await withPg(async (db) => {
      await db.query("insert into public.admin_staff(member_id) values ($1)", [staff.userId]);
    });
    ownerCookie = await sessionCookieHeader(owner.email, owner.password);
    viewerCookie = await sessionCookieHeader(viewer.email, viewer.password);
    staffCookie = await sessionCookieHeader(staff.email, staff.password);
    itemId = (await createPortfolioItem(owner, "Public Task B work", true)).id;
    draftId = (await createPortfolioItem(owner, "Secret Task B draft title", false)).id;
    app = await startTaskApp();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await withPg(async (db) => {
      for (const user of [owner, viewer, staff]) {
        if (user) {
          await db.query("delete from public.interactions where subject_id = any($1::uuid[])", [[itemId, draftId].filter(Boolean)]);
          await db.query("delete from auth.users where id = $1", [user.userId]);
        }
      }
    });
  });

  function post(route: string, cookie: string | undefined, body: unknown, origin = taskBase) {
    return fetch(`${taskBase}${route}`, {
      method: "POST", headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body), redirect: "manual",
    });
  }
  function likeBody(id = itemId) { return { subjectType: "portfolio_item", subjectId: id }; }

  it("serves published work and returns a non-leaking 404 for drafts even to the owner", async () => {
    const publicResponse = await fetch(`${taskBase}/items/${itemId}`);
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.text()).toContain("Public Task B work");
    for (const cookie of [undefined, ownerCookie]) {
      const response = await fetch(`${taskBase}/items/${draftId}`, { headers: cookie ? { cookie } : {} });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Secret Task B draft title");
    }
  });

  it("toggles through /api/likes and rejects unauthenticated, malformed, draft and cross-origin requests", async () => {
    expect((await post("/api/likes", undefined, likeBody())).status).toBe(401);
    expect((await post("/api/likes", viewerCookie, likeBody("bad-id"))).status).toBe(400);
    expect((await post("/api/likes", viewerCookie, likeBody(draftId))).status).toBe(404);
    expect((await post("/api/likes", viewerCookie, likeBody(), "https://other.test")).status).toBe(403);
    for (const [liked, likeCount] of [[true, 1], [false, 0], [true, 1]]) {
      const response = await post("/api/likes", viewerCookie, likeBody());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ liked, likeCount });
    }
    const duplicate = await viewer.client.from("interactions").insert({
      member_id: viewer.userId, subject_type: "portfolio_item", subject_id: itemId, kind: "like",
    });
    expect(duplicate.error).not.toBeNull();
  });

  it("restricts /admin and its APIs to staff, preserves omitted correction fields, and hides/unhides work", async () => {
    expect((await fetch(`${taskBase}/admin`, { redirect: "manual" })).status).toBe(307);
    expect((await fetch(`${taskBase}/admin`, { headers: { cookie: viewerCookie } })).status).toBe(404);
    expect((await fetch(`${taskBase}/admin`, { headers: { cookie: staffCookie } })).status).toBe(200);
    const hiddenBody = { ...likeBody(), hidden: true };
    expect((await post("/api/admin/set-hidden", undefined, hiddenBody)).status).toBe(401);
    expect((await post("/api/admin/set-hidden", viewerCookie, hiddenBody)).status).toBe(403);
    expect((await post("/api/admin/set-hidden", staffCookie, hiddenBody, "https://other.test")).status).toBe(403);
    const before = await owner.client.from("portfolio_items").select("title").eq("id", itemId).single();
    const correction = await post("/api/admin/update", staffCookie, { ...likeBody(), fields: { description: "Corrected description" } });
    expect(correction.status).toBe(200);
    const after = await owner.client.from("portfolio_items").select("title, description").eq("id", itemId).single();
    expect(after.data).toEqual({ title: before.data!.title, description: "Corrected description" });
    expect((await post("/api/admin/update", viewerCookie, { ...likeBody(), fields: { title: "Impersonated" } })).status).toBe(403);
    expect((await post("/api/admin/update", staffCookie, { ...likeBody(), fields: { is_hidden: true } })).status).toBe(400);
    expect((await post("/api/admin/set-hidden", staffCookie, hiddenBody)).status).toBe(200);
    for (const cookie of [undefined, ownerCookie]) {
      const response = await fetch(`${taskBase}/items/${itemId}`, { headers: cookie ? { cookie } : {} });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Corrected description");
    }
    expect((await post("/api/likes", viewerCookie, likeBody())).status).toBe(404);
    expect((await owner.client.from("portfolio_items").select("is_hidden").eq("id", itemId).single()).data?.is_hidden).toBe(true);
    expect((await post("/api/admin/set-hidden", staffCookie, { ...hiddenBody, hidden: false })).status).toBe(200);
    expect((await fetch(`${taskBase}/items/${itemId}`)).status).toBe(200);
  });

  it("rejects work whose owner is unpublished or hidden, including metadata and likes", async () => {
    for (const patch of [{ published: false }, { published: true, is_hidden: true }]) {
      await withPg(async (db) => {
        await db.query("update public.profiles set published=$2, is_hidden=$3 where id=$1", [owner.userId, patch.published, "is_hidden" in patch]);
      });
      const response = await fetch(`${taskBase}/items/${itemId}`, { headers: { cookie: ownerCookie } });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("Public Task B work");
      expect((await post("/api/likes", viewerCookie, likeBody())).status).toBe(404);
    }
  });
});
