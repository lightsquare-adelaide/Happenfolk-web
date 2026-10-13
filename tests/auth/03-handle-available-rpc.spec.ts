import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, applyRedGuard, createUser, guard, type TestUser } from "../access/_harness";

// Red mode: replace the definer RPC path with a permissive profiles
// read — proving this suite actually detects the shortcut the brief
// forbids (widening profiles' SELECT policy to answer availability).
guard(
  "03-profiles-select-permissive",
  `create policy zzz_red_03_leak on public.profiles for select using (true);`,
  `drop policy zzz_red_03_leak on public.profiles;`,
);

let claimed: TestUser;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  claimed = await createUser("claimed");
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("P2 — handle_available RPC (anonymous dedup check)", () => {
  it("answers false for taken, true for free, false for malformed", async () => {
    const supabase = anonClient();
    const taken = await supabase.rpc("handle_available", {
      p_handle: String((await ownHandle(claimed)) ?? ""),
    });
    expect(taken.error).toBeNull();
    expect(taken.data).toBe(false);

    const free = await supabase.rpc("handle_available", { p_handle: "fresh_handle_p2" });
    expect(free.error).toBeNull();
    expect(free.data).toBe(true);

    const malformed = await supabase.rpc("handle_available", { p_handle: "Bad Handle!" });
    expect(malformed.error).toBeNull();
    expect(malformed.data).toBe(false);
  });

  it("never lets anonymous visitors dump the profiles table", async () => {
    const rows = await anonClient().from("profiles").select("id, handle");
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(0);
  });
});

async function ownHandle(user: TestUser): Promise<string | null> {
  const { data } = await user.client.from("profiles").select("handle").eq("id", user.userId).single();
  return data?.handle ?? null;
}
