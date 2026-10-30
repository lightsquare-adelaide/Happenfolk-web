import { describe, expect, it } from "vitest";
import { BIO_MAX, contactEmailProblem, parseProfileForm } from "./profile";

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
  it("trims, nulls an empty bio and contact email, and reads checkboxes", () => {
    expect(parseProfileForm(form({ ...valid, published: "on" })).value).toEqual({
      display_name: "Ada Lane",
      handle: "ada_lane",
      account_kind: "individual",
      category_id: 3,
      bio: null,
      contact_email: null,
      open_to_collaborate: false,
      published: true,
    });
    expect(parseProfileForm(form(valid)).value?.published).toBe(false);
    expect(
      parseProfileForm(
        form({ ...valid, contactEmail: "  ada@example.org ", openToCollaborate: "on" }),
      ).value,
    ).toMatchObject({
      contact_email: "ada@example.org",
      open_to_collaborate: true,
    });
  });

  it.each([
    [{ displayName: "   " }, "Display name can’t be empty"],
    [{ handle: "Bad Handle" }, "Handle must be 3–30 lowercase letters, digits or underscores"],
    [{ accountKind: "admin" }, "Choose an account type"],
    [{ categoryId: "" }, "Choose a category"],
    [{ bio: "x".repeat(BIO_MAX + 1) }, `Bio must be ${BIO_MAX} characters or fewer`],
    [{ contactEmail: "not-an-email" }, "Contact email format is invalid"],
  ])("rejects %o", (override, error) => {
    expect(parseProfileForm(form({ ...valid, ...override }))).toEqual({ value: null, error });
  });
});

describe("contactEmailProblem", () => {
  it("allows empty string and valid addresses, rejects malformed addresses", () => {
    expect(contactEmailProblem("")).toBeNull();
    expect(contactEmailProblem("   ")).toBeNull();
    expect(contactEmailProblem("studio@happenfolk.org")).toBeNull();
    expect(contactEmailProblem("missing-domain@")).toBe("Contact email format is invalid");
  });
});
