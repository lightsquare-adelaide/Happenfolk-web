import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";

export type CurrentAccount = {
  /** True when a session was verified with the auth server. */
  signedIn: boolean;
  /** Public handle once onboarding has set one. */
  handle: string | null;
  /** Short fallback identifier for a member who has not finished onboarding. */
  shortId: string | null;
};

const SIGNED_OUT: CurrentAccount = { signedIn: false, handle: null, shortId: null };

/**
 * Read-only view of "who is signed in" for chrome (header, footer).
 *
 * Authorization is still getUser(), the server verified call; the local
 * session snapshot is never used for a permission decision. Wrapped in
 * React cache() so the header and the footer share one lookup per request
 * instead of each asking the auth server.
 */
export const getCurrentAccount = cache(async (): Promise<CurrentAccount> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return SIGNED_OUT;

  const { data } = await supabase
    .from("profiles")
    .select("handle")
    .eq("id", user.id)
    .maybeSingle();

  return {
    signedIn: true,
    handle: data?.handle ?? null,
    shortId: user.id.slice(0, 8),
  };
});

/** What the chrome shows for a member: their handle, else a short id. */
export function accountLabel(account: CurrentAccount): string {
  return account.handle ?? account.shortId ?? "member";
}
