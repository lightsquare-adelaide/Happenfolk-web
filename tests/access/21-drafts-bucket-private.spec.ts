import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyRedGuard,
  createUser,
  guard,
  stackConfig,
  type TestUser,
} from "./_harness";

// Red mode: an everyone-permissive select policy on storage.objects —
// another user can read the private object and the denial assertions
// must FAIL.
guard(
  "21-storage-select-permissive",
  `create policy zzz_red_21_open on storage.objects for select using (true);`,
  `drop policy zzz_red_21_open on storage.objects;`,
);

let alice: TestUser;
let bob: TestUser;
let masterPath: string;
let undoRed: (() => Promise<void>) | null = null;

beforeAll(async () => {
  undoRed = await applyRedGuard();
  alice = await createUser("alice");
  bob = await createUser("bob");

  // The drafts bucket is private; uploads are scoped to the owner's
  // uid/ folder by policy.
  masterPath = `${alice.userId}/master-${Date.now()}.txt`;
  const up = await alice.client.storage
    .from("drafts")
    .upload(masterPath, "unpublished master bytes", { contentType: "text/plain" });
  expect(up.error).toBeNull();
});

afterAll(async () => {
  if (undoRed) await undoRed();
});

describe("scenario 21 — guessing another user's drafts path", () => {
  it("yields another authenticated user nothing", async () => {
    // BUILD_PLAN calls this "403"; the observed storage contract is
    // 400 "Object not found": the RLS-denied row is indistinguishable
    // from a missing key, so there is no existence oracle either.
    const peek = await bob.client.storage.from("drafts").download(masterPath);
    expect(peek.error).toBeTruthy();
    expect((peek.error as { status?: number } | null)?.status).toBe(400);
    expect((peek.error as { message?: string } | null)?.message).toBe(
      "Object not found",
    );
  });

  it("yields the anonymous public URL nothing", async () => {
    // Private bucket + public route: 400, never the bytes.
    const res = await fetch(
      `${stackConfig().url}/storage/v1/object/public/drafts/${masterPath}`,
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});
