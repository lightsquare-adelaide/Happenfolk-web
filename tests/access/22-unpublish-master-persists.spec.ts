import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  applyRedGuard,
  createPortfolioItem,
  createUser,
  guard,
  stackConfig,
  type ItemRow,
  type TestUser,
} from "./_harness";

// Red mode: drop the delete policy on storage.objects — the owner
// cannot retract the public object, the public URL stays 200 and the
// 404 assertion must FAIL.
guard(
  "22-members-delete-own-folder",
  `drop policy "members delete own folder" on storage.objects;`,
  `create policy "members delete own folder" on storage.objects
     for delete to authenticated
     using (
       bucket_id in ('avatars', 'media', 'covers', 'drafts')
       and (storage.foldername(name))[1] = auth.uid()::text
     );`,
);

let owner: TestUser;
let item: ItemRow;
let publicPath: string;
let masterPath: string;
let undoRed: (() => Promise<void>) | null = null;

const publicUrl = (path: string) =>
  `${stackConfig().url}/storage/v1/object/public/media/${path}`;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  owner = await createUser("owner");
  item = await createPortfolioItem(owner, "Retraction Study", true);

  publicPath = `${owner.userId}/shown-${Date.now()}.txt`;
  masterPath = `${owner.userId}/master-${Date.now()}.txt`;
  const upPublic = await owner.client.storage
    .from("media")
    .upload(publicPath, "public derived bytes", { contentType: "text/plain" });
  const upMaster = await owner.client.storage
    .from("drafts")
    .upload(masterPath, "private master bytes", { contentType: "text/plain" });
  expect(upPublic.error).toBeNull();
  expect(upMaster.error).toBeNull();
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 22 — un-publish retracts the public URL, master survives", () => {
  it("404s the old public URL and keeps the drafts original", async () => {
    // Precondition: public while published.
    const before = await fetch(publicUrl(publicPath));
    expect(before.ok).toBe(true);

    // Un-publish the item...
    const unpublish = await owner.client
      .from("portfolio_items")
      .update({ published: false })
      .eq("id", item.id);
    expect(unpublish.error).toBeNull();

    // ...and retract the public object (the media pipeline's duty on
    // un-publish — exercised here at the storage layer).
    const removed = await owner.client.storage.from("media").remove([publicPath]);
    expect(removed.error).toBeNull();

    // The public URL is gone. Wire-level quirk (observed, pinned):
    // storage-api answers missing objects with HTTP 400 carrying
    // statusCode "404" / "Object not found" in the body.
    const after = await fetch(publicUrl(publicPath));
    expect(after.status).toBe(400);
    const body = (await after.json()) as { statusCode?: string; message?: string };
    expect(body.statusCode).toBe("404");
    expect(body.message).toBe("Object not found");

    // ...its row is no longer readable by anon...
    const row = await anonClient()
      .from("media_assets")
      .select("id")
      .eq("portfolio_item_id", item.id);
    expect(row.error).toBeNull();
    expect(row.data).toHaveLength(0);

    // ...but the private master is intact for its owner.
    const master = await owner.client.storage.from("drafts").download(masterPath);
    expect(master.error).toBeNull();
    expect(await master.data?.text()).toBe("private master bytes");
  });
});
