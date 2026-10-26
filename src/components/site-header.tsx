import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { accountLabel, getCurrentAccount } from "@/lib/current-account";
import { Logo } from "./logo";
import { MobileNav } from "./mobile-nav";
import { Z } from "./nav-items";
import { PrimaryNav } from "./primary-nav";
import { ThemeToggle } from "./theme-toggle";
import { secondaryButtonClass } from "./field";

/**
 * Sticky shell header.
 *
 * Login state comes from getCurrentAccount(), which authorizes with getUser()
 * (server verified); the local session snapshot is never used for a permission
 * decision. The same cached lookup feeds the footer, so the chrome costs one
 * auth call per request.
 *
 * Responsive rule that fixes the 390px overflow: below 768px the header holds
 * exactly three things (lockup, theme control, menu button). Section links and
 * the account cluster live in the MobileNav disclosure, so a 30-character
 * handle can never widen the document. Every flexible child carries min-w-0 and
 * truncates rather than pushing the row.
 */
export async function SiteHeader() {
  const account = await getCurrentAccount();

  return (
    <header className={`sticky top-0 ${Z.header} border-b border-line bg-background`}>
      <div className="shell-wrap relative flex h-16 items-center gap-2 sm:gap-3">
        <Link
          href="/"
          aria-label={`${BRAND.name} home`}
          className="shrink-0 text-foreground transition-colors duration-200 hover:text-brand-text"
        >
          <Logo />
        </Link>

        <PrimaryNav className="hidden md:flex" />

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <ThemeToggle />

          {account.signedIn ? (
            <div className="hidden min-w-0 items-center gap-2 md:flex">
              <Link
                href="/dashboard"
                className="inline-flex min-h-11 max-w-[12rem] items-center gap-2 border border-line-strong px-3 text-sm transition-colors duration-200 hover:border-brand hover:text-brand-text"
              >
                <span className="sr-only">Dashboard, </span>
                <span className="min-w-0 truncate font-mono">@{accountLabel(account)}</span>
              </Link>
              <form action="/auth/signout" method="post">
                <button type="submit" className={secondaryButtonClass}>
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center px-3 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-200 hover:text-foreground"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="inline-flex min-h-11 items-center bg-brand px-4 text-sm font-semibold whitespace-nowrap text-on-brand transition-[background-color,transform] duration-200 hover:bg-brand-hover active:translate-y-px"
              >
                Create account
              </Link>
            </div>
          )}

          <MobileNav account={account} />
        </div>
      </div>
    </header>
  );
}
