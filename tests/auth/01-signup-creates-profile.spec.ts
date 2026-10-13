import { describe, expect, it } from "vitest";
import { createUser } from "./_harness";

describe("P2 — signup creates the profile row via handle_new_user", () => {
  it("a fresh signup has a matching profile row with an auto handle", async () => {
    const user = await createUser("profile");
    const { data, error } = await user.client
      .from("profiles")
      .select("id, handle, account_kind, category_id")
      .eq("id", user.userId)
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: user.userId, account_kind: "individual" });
    // handle_new_user derived the handle from the email local-part
    // ("profile-<runId>" -> "profile_<runId>") and sanitised it to the
    // handle shape.
    expect(String(data?.handle)).toMatch(/^profile_[a-z0-9_]+$/);
    // Onboarding has not happened: no category chosen yet — this is the
    // marker middleware uses to bounce users to /onboarding.
    expect(data?.category_id).toBeNull();
  });
});
