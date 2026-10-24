import Link from "next/link";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { NavLinks, TabBar } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { BRAND } from "@/lib/brand";
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
    <>
      <p className="preview-bar">
        <b>Preview build.</b> Real accounts, profiles and portfolios; events and the Newsfeed use sample data and some
        buttons are not live yet.
      </p>
      <header className="nav">
        <div className="wrap">
          <Link className="logo" href="/" aria-label={`${BRAND.name} home`}>
            <Logo />
          </Link>
          <NavLinks />
          <form className="search" role="search" action="/search">
            <label htmlFor="q" className="sr-only">
              Search artists and events
            </label>
            <Icon name="search" />
            <input id="q" name="q" type="search" placeholder="Search artists and events" />
          </form>
          <div className="nav-actions">
            <ThemeToggle />
            {user ? (
              <>
                <Link className="btn btn-text" href="/dashboard">
                  @{handle ?? user.id.slice(0, 8)}
                </Link>
                <form action="/auth/signout" method="post">
                  <button type="submit" className="btn btn-ghost">
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link className="btn btn-text" href="/login">
                  Sign in
                </Link>
                <Link className="btn btn-primary" href="/register">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <TabBar signedIn={!!user} />
    </>
  );
}
