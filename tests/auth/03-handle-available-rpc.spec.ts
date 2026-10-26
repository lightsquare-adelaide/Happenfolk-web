import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, applyRedGuard, createUser, guard, type TestUser } from "../access/_harness";

// Red mode: replace the definer RPC path with a permissive profiles
// read — proving this suite actually detects the shortcut the brief
// forbids (widening profiles' SELECT policy to answer availability).
guard(
  "03-profiles-select-permissive",
  `create policy zzz_red_03_leak on public.profiles for select using (true);`,
  `drop policy zzz_red_03_leak on public.profiles;`,
);

let claimed: TestUser;
let published: TestUser;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  claimed = await createUser("claimed");
  published = await createUser("published");
  const result = await published.client.from("profiles").update({ published: true }).eq("id", published.userId);
  if (result.error) throw result.error;
});

afterAll(async () => {
  if (undoRed) await undoRed();
  const ids = [claimed?.userId, published?.userId].filter(Boolean);
  if (ids.length) await (await admin()).query("delete from auth.users where id = any($1::uuid[])", [ids]);
});

describe("P2 — handle_available RPC (anonymous dedup check)", () => {
  it("answers false for taken, true for free, false for malformed", async () => {
    const supabase = anonClient();
    const taken = await supabase.rpc("handle_available", {
      p_handle: String((await ownHandle(claimed)) ?? ""),
    });
    expect(taken.error).toBeNull();
    expect(taken.data).toBe(false);

    const free = await supabase.rpc("handle_available", { p_handle: `free_${claimed.userId.replaceAll("-", "").slice(0, 20)}` });
    expect(free.error).toBeNull();
    expect(free.data).toBe(true);

    const malformed = await supabase.rpc("handle_available", { p_handle: "Bad Handle!" });
    expect(malformed.error).toBeNull();
    expect(malformed.data).toBe(false);
  });

  it("hides unpublished profiles while allowing intentionally published profiles", async () => {
    const rows = await anonClient().from("profiles").select("id, handle").eq("id", claimed.userId);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(0);

    const publicRows = await anonClient().from("profiles").select("id, handle").eq("id", published.userId);
    expect(publicRows.error).toBeNull();
    expect(publicRows.data).toHaveLength(1);
  });
});

async function ownHandle(user: TestUser): Promise<string | null> {
  const { data } = await user.client.from("profiles").select("handle").eq("id", user.userId).single();
  return data?.handle ?? null;
}
