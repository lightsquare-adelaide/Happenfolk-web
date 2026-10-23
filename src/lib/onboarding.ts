import { safeNextPath } from "./safe-next-path";

/**
 * Onboarding form rules, kept framework-free so they can be unit
 * tested as pure functions.
 */

export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

/** True when the handle matches the product's handle shape. */
export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle);
}

/** Human-readable validation problem, or null when acceptable. */
export function handleProblem(handle: string): string | null {
  if (handle.length === 0) return "Handle can’t be empty";
  if (!isValidHandle(handle)) {
    return "Handle must be 3–30 lowercase letters, digits or underscores";
  }
  return null;
}

export type AccountKind = "individual" | "organisation";

/** True only for the two account kinds the product defines. */
export function isValidAccountKind(kind: string): kind is AccountKind {
  return kind === "individual" || kind === "organisation";
}

/**
 * Where to send a member once onboarding is complete (FR-ACC-07). Reuses
 * safeNextPath, and refuses /onboarding itself: the page redirects a
 * finished member to this target, so pointing it back would loop.
 */
export function afterOnboardingPath(next: unknown): string {
  const path = safeNextPath(typeof next === "string" ? next : null);
  return /^\/onboarding(?:[/?#]|$)/.test(path) ? "/dashboard" : path;
}
