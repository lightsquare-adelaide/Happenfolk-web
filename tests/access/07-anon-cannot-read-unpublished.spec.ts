import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  applyRedGuard,
  createPortfolioItem,
  createUser,
  guard,
  type ItemRow,
  type TestUser,
} from "./_harness";

// Red mode: a permissive select policy — anonymous visitors see the
// draft and the "zero rows" assertion must FAIL.
guard(
  "07-portfolio-select-permissive",
  `create policy zzz_red_07_leak on public.portfolio_items for select using (true);`,
  `drop policy zzz_red_07_leak on public.portfolio_items;`,
);

let owner: TestUser;
let draft: ItemRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  owner = await createUser("owner");
  draft = await createPortfolioItem(owner, "Unfinished Draft", false);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 7 — anonymous visitor reads an unpublished portfolio item", () => {
  it("sees zero rows", async () => {
    const listed = await anonClient()
      .from("portfolio_items")
      .select("id, title")
      .eq("id", draft.id);
    expect(listed.error).toBeNull();
    expect(listed.data).toHaveLength(0);

    // The draft's media rows must be equally invisible.
    const media = await anonClient()
      .from("media_assets")
      .select("id")
      .eq("portfolio_item_id", draft.id);
    expect(media.error).toBeNull();
    expect(media.data).toHaveLength(0);
  });
});
