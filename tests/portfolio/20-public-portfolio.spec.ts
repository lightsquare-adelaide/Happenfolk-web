import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { appBase, createUser, sessionCookieHeader, startApp, uploadRequest, type TestUser } from "../media/_harness";
import { stackConfig } from "../access/_harness";

describe("public portfolio pages on the real stack", () => {
  let owner: TestUser;
  let cookie: string;
  let handle: string;
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  const ids: string[] = [];
  const stamp = Date.now();
  const titles = [`Earlier work ${stamp}`, `Later work ${stamp}`, `Private work ${stamp}`];

  beforeAll(async () => {
    owner = await createUser("public-portfolio");
    const profile = await owner.client.from("profiles").update({ published: true, category_id: 1 }).eq("id", owner.userId).select("handle").single();
    expect(profile.error).toBeNull();
    handle = profile.data!.handle;
    cookie = await sessionCookieHeader(owner.email, owner.password);
    app = await startApp();
    const image = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#ae275f" } }).jpeg().toBuffer();
    for (const [index, title] of titles.entries()) {
      const response = await fetch(`${appBase()}/api/media/upload`, uploadRequest(cookie, "colour-study.jpg", image, { altText: `A magenta colour study ${index}` }));
      const uploaded = await response.json();
      expect(response.status, JSON.stringify(uploaded)).toBe(201);
      ids.push(uploaded.itemId);
      const edited = await owner.client.from("portfolio_items").update({ title, description: "A study of colour and form.", year: 2024 + index, tags: ["Colour", "  FORM "] }).eq("id", uploaded.itemId);
      expect(edited.error).toBeNull();
      if (index < 2) {
        const published = await fetch(`${appBase()}/api/media/publish`, { method: "POST", headers: { cookie, origin: appBase(), "content-type": "application/json" }, body: JSON.stringify({ itemId: uploaded.itemId }) });
        expect(published.status, await published.text()).toBe(200);
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (!owner) return;
    const cleanup = owner.client;
    for (const bucket of ["media", "drafts"]) {
      const listed = await cleanup.storage.from(bucket).list(owner.userId, { limit: 1000 });
      expect(listed.error).toBeNull();
      if (listed.data?.length) expect((await cleanup.storage.from(bucket).remove(listed.data.map((file) => `${owner.userId}/${file.name}`))).error).toBeNull();
    }
    const db = new pg.Client({ connectionString: stackConfig().dbUrl });
    await db.connect();
    try {
      await db.query("delete from public.portfolio_items where id = any($1::uuid[])", [ids]);
      await db.query("delete from auth.users where id = $1", [owner.userId]);
    } finally { await db.end(); }
  });

  async function page(cookieHeader?: string) {
    const response = await fetch(`${appBase()}/artists/${handle}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
    expect(response.status).toBe(200);
    return response.text();
  }

  test("anonymous HTML shows published metadata, public media and stored item order", async () => {
    const html = await page();
    expect(html).toContain(titles[0]);
    expect(html).toContain(titles[1]);
    expect(html.indexOf(titles[0])).toBeLessThan(html.indexOf(titles[1]));
    expect(html).toContain("2024");
    expect(html).toContain("#colour");
    expect(html).toContain("#form");
    expect(html).toContain("/object/public/media/");
    expect(html).not.toContain(titles[2]);
    expect(html).not.toContain("/object/public/drafts/");
    expect(html).not.toContain("/object/sign/drafts/");
  });

  test("accepted reorder RPC changes the anonymous rendered item order", async () => {
    const moved = await owner.client.rpc("move_portfolio_item", { p_item_id: ids[1], p_direction: "up" });
    expect(moved.error).toBeNull();
    expect(moved.data).toBe(true);
    const html = await page();
    expect(html.indexOf(titles[1])).toBeLessThan(html.indexOf(titles[0]));
  });

  test("owner draft preview labels private media without disclosing a draft URL", async () => {
    const html = await page(cookie);
    expect(html).toContain(titles[2]);
    expect(html).toContain("Draft media is private");
    expect(html).toContain("Draft · only you");
    expect(html).toContain("/dashboard/portfolio");
    expect(html).not.toContain("/object/public/drafts/");
    expect(html).not.toContain("/object/sign/drafts/");
  });
});
