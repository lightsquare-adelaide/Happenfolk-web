import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyRedGuard,
  createPortfolioItem,
  createUser,
  guard,
  type ItemRow,
  type TestUser,
} from "./_harness";

/**
 * Audit A6 (26 October 2026). 0004's "no empty publication" guard watched
 * two doors: flipping an item to published, and touching media on an
 * already-published item. Four paths got around it — inserting an item
 * already published (the alt_text check quantified over an empty media
 * set), deleting a published work's media, moving that media onto another
 * of the owner's works, and deleting the last two rows concurrently.
 * Migration 20261026000300 closes all four; deleting a whole work still
 * cascades, and the unpublish pipeline still removes public derivatives
 * while the private masters stay attached.
 */

// Red mode: without the DELETE trigger the owner strips a published work
// and the "refused" assertion fails.
guard(
  "24a-last-media-delete-guard-dropped",
  `drop trigger trg_media_assets_last_media_delete on public.media_assets;`,
  `create trigger trg_media_assets_last_media_delete
     before delete on public.media_assets
     for each row execute function public.media_assets_last_media_guard ();`,
);

// Red mode: without the UPDATE trigger the same end state is reached by
// reassigning the row instead of deleting it.
guard(
  "24b-last-media-move-guard-dropped",
  `drop trigger trg_media_assets_last_media_move on public.media_assets;`,
  `create trigger trg_media_assets_last_media_move
     before update of portfolio_item_id on public.media_assets
     for each row execute function public.media_assets_last_media_guard ();`,
);

// Red mode: 0004's original publish guard, which had no "media attached"
// check — publishing an empty work succeeds again and the assertion fails.
guard(
  "24c-publish-guard-media-check-removed",
  `create or replace function public.portfolio_items_publish_guard ()
   returns trigger language plpgsql set search_path = '' as $guard$
   begin
     if new.published then
       if exists (
         select 1 from public.media_assets m
         where m.portfolio_item_id = new.id
           and (m.alt_text is null or btrim(m.alt_text) = '')
       ) then
         raise exception 'cannot publish portfolio item: media alt_text missing';
       end if;
       if old.published is distinct from true then
         new.published_at := coalesce(old.published_at, now ());
       end if;
     end if;
     return new;
   end;
   $guard$;`,
  `create or replace function public.portfolio_items_publish_guard ()
   returns trigger language plpgsql set search_path = '' as $guard$
   begin
     if new.published then
       if not exists (
         select 1 from public.media_assets m
         where m.portfolio_item_id = new.id
       ) then
         raise exception 'cannot publish portfolio item: no media attached';
       end if;
       if exists (
         select 1 from public.media_assets m
         where m.portfolio_item_id = new.id
           and (m.alt_text is null or btrim(m.alt_text) = '')
       ) then
         raise exception 'cannot publish portfolio item: media alt_text missing';
       end if;
       if old.published is distinct from true then
         new.published_at := coalesce(old.published_at, now ());
       end if;
     end if;
     return new;
   end;
   $guard$;`,
);

let owner: TestUser;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  owner = await createUser("audit-a6-owner");
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

type MediaRow = { id: string; bucket: string; variant: string };

async function mediaOf(itemId: string): Promise<MediaRow[]> {
  const { data, error } = await owner.client
    .from("media_assets")
    .select("id, bucket, variant")
    .eq("portfolio_item_id", itemId);
  if (error) throw new Error(`mediaOf failed: ${error.message}`);
  return (data ?? []) as MediaRow[];
}

/** Attaches an extra alt-texted row, as a draft master or a public variant. */
async function addMedia(
  itemId: string,
  name: string,
  bucket: "drafts" | "media",
  variant = "original",
): Promise<string> {
  const { data, error } = await owner.client
    .from("media_assets")
    .insert({
      portfolio_item_id: itemId,
      path: `${bucket}/${owner.userId}/${name}.jpg`,
      alt_text: `${name} alt text`,
      content_type: "image/jpeg",
      bucket,
      variant,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`addMedia failed: ${error?.message}`);
  return data.id as string;
}

describe("audit A6 — an empty work can never be public", () => {
  it("refuses to insert an item that is already published with no media", async () => {
    const { error } = await owner.client.from("portfolio_items").insert({
      profile_id: owner.userId,
      title: "Born Published",
      media_kind: "image",
      published: true,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("no media attached");
  });

  it("refuses to publish a draft that has no media, and allows it once media exists", async () => {
    const { data: draft, error: createError } = await owner.client
      .from("portfolio_items")
      .insert({
        profile_id: owner.userId,
        title: "Empty Draft",
        media_kind: "image",
      })
      .select("id")
      .single();
    expect(createError).toBeNull();
    if (!draft) throw new Error("fixture failed: the empty draft was not created");
    const itemId = draft.id as string;

    const tooEarly = await owner.client
      .from("portfolio_items")
      .update({ published: true })
      .eq("id", itemId);
    expect(tooEarly.error?.message).toContain("no media attached");

    await addMedia(itemId, "empty-draft-artwork", "drafts");
    const published = await owner.client
      .from("portfolio_items")
      .update({ published: true })
      .eq("id", itemId)
      .select("published")
      .single();
    expect(published.error).toBeNull();
    expect(published.data?.published).toBe(true);
  });

  it("refuses to delete the last media row of a published work", async () => {
    const item: ItemRow = await createPortfolioItem(owner, "Guarded Print", true);
    const rows = await mediaOf(item.id);
    expect(rows).toHaveLength(1);

    const { error } = await owner.client.from("media_assets").delete().eq("id", rows[0].id);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("without media");
    expect(await mediaOf(item.id)).toHaveLength(1);
  });

  it("refuses to move the last media row of a published work onto another work", async () => {
    const published = await createPortfolioItem(owner, "Source Work", true);
    const { data: target, error: targetError } = await owner.client
      .from("portfolio_items")
      .insert({
        profile_id: owner.userId,
        title: "Receiver Work",
        media_kind: "image",
      })
      .select("id")
      .single();
    expect(targetError).toBeNull();
    if (!target) throw new Error("fixture failed: the receiver work was not created");

    const [row] = await mediaOf(published.id);
    const { error } = await owner.client
      .from("media_assets")
      .update({ portfolio_item_id: target.id as string })
      .eq("id", row.id);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("without media");
    expect(await mediaOf(published.id)).toHaveLength(1);
  });

  it("still deletes a whole work, media rows and all", async () => {
    const item = await createPortfolioItem(owner, "Doomed Work", true);
    await addMedia(item.id, "doomed-extra", "media", "small");
    expect(await mediaOf(item.id)).toHaveLength(2);

    const { error } = await owner.client.from("portfolio_items").delete().eq("id", item.id);
    expect(error).toBeNull();

    const after = await owner.client
      .from("portfolio_items")
      .select("id")
      .eq("id", item.id);
    expect(after.data).toHaveLength(0);
    expect(await mediaOf(item.id)).toHaveLength(0);
  });

  it("still lets unpublish drop the public derivatives while the masters stay", async () => {
    const item = await createPortfolioItem(owner, "Unpublish Shape", true);
    // The pipeline's shape: a private master plus public derivatives.
    const master = await addMedia(item.id, "unpublish-master", "drafts");
    const variant = (await mediaOf(item.id)).find((r) => r.bucket === "media");

    const { error } = await owner.client
      .from("media_assets")
      .delete()
      .eq("portfolio_item_id", item.id)
      .eq("bucket", "media");
    expect(error).toBeNull();

    const remaining = await mediaOf(item.id);
    expect(remaining.map((r) => r.id)).toEqual([master]);
    expect(variant).toBeDefined();
  });
});
