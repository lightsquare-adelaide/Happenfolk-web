import { describe, expect, it } from "vitest";
import { BIO_MAX, parseProfileForm } from "./profile";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  displayName: "  Ada Lane ",
  handle: "ada_lane",
  accountKind: "individual",
  categoryId: "3",
  bio: "",
};

describe("parseProfileForm", () => {
  it("trims, nulls an empty bio and reads the published checkbox", () => {
    expect(parseProfileForm(form({ ...valid, published: "on" })).value).toEqual({
      display_name: "Ada Lane",
      handle: "ada_lane",
      account_kind: "individual",
      category_id: 3,
      bio: null,
      published: true,
    });
    expect(parseProfileForm(form(valid)).value?.published).toBe(false);
  });

  it.each([
    [{ displayName: "   " }, "Display name can’t be empty"],
    [{ handle: "Bad Handle" }, "Handle must be 3–30 lowercase letters, digits or underscores"],
    [{ accountKind: "admin" }, "Choose an account type"],
    [{ categoryId: "" }, "Choose a category"],
    [{ bio: "x".repeat(BIO_MAX + 1) }, `Bio must be ${BIO_MAX} characters or fewer`],
  ])("rejects %o", (override, error) => {
    expect(parseProfileForm(form({ ...valid, ...override }))).toEqual({ value: null, error });
  });
});
