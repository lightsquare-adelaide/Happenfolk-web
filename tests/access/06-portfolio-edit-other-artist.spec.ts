import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyRedGuard,
  createPortfolioItem,
  createUser,
  guard,
  readScalar,
  type ItemRow,
  type TestUser,
} from "./_harness";

// Red mode: permissive update policy on portfolio_items — the other
// artist's patch lands and the "unchanged" assertion must FAIL.
guard(
  "06-portfolio-update-permissive",
  `drop policy "members update own portfolio items" on public.portfolio_items;
   create policy zzz_red_06_permissive on public.portfolio_items
     for update to authenticated using (true) with check (true);`,
  `drop policy zzz_red_06_permissive on public.portfolio_items;
   create policy "members update own portfolio items" on public.portfolio_items
     for update to authenticated
     using (profile_id = auth.uid())
     with check (profile_id = auth.uid());`,
);

let owner: TestUser;
let other: TestUser;
let item: ItemRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  owner = await createUser("owner");
  other = await createUser("other");
  item = await createPortfolioItem(owner, "Sunset Study", true);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 6 — artist edits another artist's portfolio item", () => {
  it("is silently filtered: data ends unchanged", async () => {
    const { error } = await other.client
      .from("portfolio_items")
      .update({ title: "Plagiarised" })
      .eq("id", item.id);
    expect(error).toBeNull(); // 204, zero rows

    expect(await readScalar(owner.client, "portfolio_items", item.id, "title")).toBe(
      "Sunset Study",
    );
  });
});
