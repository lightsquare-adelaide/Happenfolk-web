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

// Red mode: drop the public-read policy — published items vanish for
// anonymous visitors and the "found" assertion must FAIL.
guard(
  "08-portfolio-select-dropped",
  `drop policy "published portfolio items are world-readable" on public.portfolio_items;`,
  `create policy "published portfolio items are world-readable" on public.portfolio_items
     for select to anon, authenticated
     using (published or profile_id = auth.uid());`,
);

let owner: TestUser;
let item: ItemRow;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  owner = await createUser("owner");
  item = await createPortfolioItem(owner, "Published Painting", true);
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 8 — anonymous visitor reads a published portfolio item", () => {
  it("succeeds and returns the row", async () => {
    const { data, error } = await anonClient()
      .from("portfolio_items")
      .select("id, title, published")
      .eq("id", item.id)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: item.id, title: "Published Painting", published: true });

    // Its (alt-texted) media is public too.
    const media = await anonClient()
      .from("media_assets")
      .select("alt_text, bucket")
      .eq("portfolio_item_id", item.id);
    expect(media.error).toBeNull();
    expect(media.data).toHaveLength(1);
    expect(media.data?.[0]).toMatchObject({ bucket: "media" });
    expect(String(media.data?.[0]?.alt_text)).toContain("alt text");
  });
});
