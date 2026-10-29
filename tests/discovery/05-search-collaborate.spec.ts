import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, type TestUser } from "../access/_harness";
import { withPg, anonClient } from "../compliance/_harness";
import { startTaskApp, taskBase } from "../compliance/_server";

describe("Task B collaboration directory", () => {
  const users: TestUser[] = [];
  const stamp = Date.now();
  let app: Awaited<ReturnType<typeof startTaskApp>> | undefined;
  let musicName: string;
  let filmName: string;

  beforeAll(async () => {
    for (const [index, label] of ["music", "film", "closed", "private", "hidden"].entries()) {
      const user = await createUser(`b-collab-${label}`);
      users.push(user);
      const name = `Collab ${label} ${stamp}`;
      if (index === 0) musicName = name;
      if (index === 1) filmName = name;
      expect((await user.client.from("profiles").update({
        display_name: name, category_id: index === 1 ? 6 : 1,
        published: index !== 3, open_to_collaborate: index !== 2,
      }).eq("id", user.userId)).error).toBeNull();
    }
    await withPg(async (db) => {
      await db.query("update public.profiles set is_hidden=true where id=$1", [users[4].userId]);
    });
    app = await startTaskApp();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await withPg(async (db) => {
      for (const user of users) await db.query("delete from auth.users where id=$1", [user.userId]);
    });
  });

  it("exposes only published opt-ins in the rendered directory and respects the category URL", async () => {
    const response = await fetch(`${taskBase}/collaborate`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(musicName);
    expect(html).toContain(filmName);
    for (const label of ["closed", "private", "hidden"]) {
      expect(html).not.toContain(`Collab ${label} ${stamp}`);
    }
    const filtered = await fetch(`${taskBase}/collaborate?category=music`);
    expect(filtered.status).toBe(200);
    // Inspect rendered cards: Next's hydration data may include other categories
    // because the same client component supports changing the filter in place.
    const markup = (await filtered.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
    expect(markup).toContain(musicName);
    expect(markup).not.toContain(filmName);
    expect(markup).toContain('aria-pressed="true"');
  });

  it("keeps sign-in email private until an owner explicitly saves a contact address", async () => {
    const musician = users[0];
    const read = () => anonClient().from("profiles").select("contact_email").eq("id", musician.userId).single();
    expect((await read()).data?.contact_email).toBeNull();
    expect((await musician.client.from("profiles").update({ contact_email: "studio@example.org" }).eq("id", musician.userId)).error).toBeNull();
    expect((await read()).data?.contact_email).toBe("studio@example.org");
    const html = await (await fetch(`${taskBase}/collaborate`)).text();
    expect(html).toContain("studio@example.org");
    expect(html).not.toContain(musician.email);
    expect((await musician.client.from("profiles").update({ contact_email: null }).eq("id", musician.userId)).error).toBeNull();
    expect((await read()).data?.contact_email).toBeNull();
    expect(await (await fetch(`${taskBase}/collaborate`)).text()).not.toContain("studio@example.org");
  });
});
