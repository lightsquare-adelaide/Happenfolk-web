import { BRAND } from "@/lib/brand";
import Link from "next/link";
import { createSupabaseServerClient } from "../lib/supabase/server";

/**
 * Header with login-state awareness. Authorization via getUser()
 * (server verified) — never the local session snapshot().
 */
export async function SiteHeader() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let handle: string | null = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("handle")
      .eq("id", user.id)
      .maybeSingle();
    handle = data?.handle ?? null;
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-brand-700">
          {BRAND.name}
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-4 text-sm text-muted">
          <span>Discover</span>
          <span>Artists</span>
          <span>Events</span>
          {user ? (
            <span className="flex items-center gap-3">
              <Link href="/dashboard" className="font-mono text-foreground">
                @{handle ?? user.id.slice(0, 8)}
              </Link>
              <form action="/auth/signout" method="post">
                <button type="submit" className="underline">
                  Log out
                </button>
              </form>
            </span>
          ) : (
            <>
              <Link href="/login" className="underline">
                Log in
              </Link>
              <Link href="/register" className="underline">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
