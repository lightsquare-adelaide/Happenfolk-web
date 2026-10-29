/**
 * Profile editor rules (FR-PRO-01, FR-PRO-03, FR-ACC-04, FR-ACC-06),
 * kept framework-free so they can be unit tested as pure functions.
 */
import { handleProblem, isValidAccountKind, type AccountKind } from "./onboarding";

// Not fixed by the SRS or the schema; app-level limits until the team agrees others.
export const DISPLAY_NAME_MAX = 80;
export const BIO_MAX = 1000;

export type ProfileUpdate = {
  display_name: string;
  handle: string;
  account_kind: AccountKind;
  category_id: number;
  bio: string | null;
  contact_email: string | null;
  open_to_collaborate: boolean;
  published: boolean;
};

/** Empty or a rough email shape; delivery is the sender's problem. */
export function contactEmailProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Contact email format is invalid";
  return null;
}

/** Validates editor form input into a profiles update, or a readable error. */
export function parseProfileForm(
  formData: FormData,
): { value: ProfileUpdate; error: null } | { value: null; error: string } {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const handle = String(formData.get("handle") ?? "");
  const kind = String(formData.get("accountKind") ?? "");
  const categoryId = Number(formData.get("categoryId"));
  const bio = String(formData.get("bio") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  const fail = (error: string) => ({ value: null, error });

  if (displayName.length === 0) return fail("Display name can’t be empty");
  if (displayName.length > DISPLAY_NAME_MAX) {
    return fail(`Display name must be ${DISPLAY_NAME_MAX} characters or fewer`);
  }
  const problem = handleProblem(handle);
  if (problem) return fail(problem);
  if (!isValidAccountKind(kind)) return fail("Choose an account type");
  if (!Number.isInteger(categoryId) || categoryId <= 0) return fail("Choose a category");
  if (bio.length > BIO_MAX) return fail(`Bio must be ${BIO_MAX} characters or fewer`);
  const emailProblem = contactEmailProblem(contactEmail);
  if (emailProblem) return fail(emailProblem);

  return {
    value: {
      display_name: displayName,
      handle,
      account_kind: kind,
      category_id: categoryId,
      bio: bio.length > 0 ? bio : null,
      contact_email: contactEmail.length > 0 ? contactEmail : null,
      open_to_collaborate: formData.get("openToCollaborate") === "on",
      published: formData.get("published") === "on",
    },
    error: null,
  };
}
