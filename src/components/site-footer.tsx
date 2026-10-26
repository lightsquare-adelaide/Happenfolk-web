import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { accountLabel, getCurrentAccount } from "@/lib/current-account";
import { BrandMark } from "./logo";
import { PRIMARY_NAV } from "./nav-items";

const footerLinkClass =
  "inline-block py-1 text-sm text-muted underline decoration-line-strong underline-offset-4 transition-colors duration-200 hover:text-brand-text hover:decoration-brand";

/**
 * Shell footer. Static plus one account-aware column, so it never needs its
 * own auth lookup: getCurrentAccount() is cached per request and already ran
 * for the header.
 *
 * Legal, privacy, licence and credits links belong to the launch-readiness
 * package, which owns those routes. They are not linked here yet, because a
 * footer link to a route that does not exist is worse than no link.
 */
export async function SiteFooter() {
  const account = await getCurrentAccount();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="shell-wrap grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-foreground">
            <BrandMark className="h-5 w-5" />
            <span className="font-display text-base font-extrabold uppercase leading-none tracking-tight">
              {BRAND.name}
            </span>
          </span>
          <p className="max-w-sm text-sm leading-6 text-muted">
            A showcase for South Australian independent artists: public profiles, portfolios and
            events, with member tools for the artists themselves.
          </p>
        </div>

        <nav aria-label="Explore" className="flex flex-col">
          <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-foreground">
            Explore
          </h2>
          {PRIMARY_NAV.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} className={footerLinkClass}>
              {item.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Account" className="flex flex-col">
          <h2 className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-foreground">
            {account.signedIn ? "Your account" : "For artists"}
          </h2>
          {account.signedIn ? (
            <>
              <Link href="/dashboard" className={footerLinkClass}>
                Dashboard
              </Link>
              <Link href="/dashboard/profile" className={footerLinkClass}>
                Edit profile
              </Link>
              {account.handle ? (
                <Link href={`/artists/${account.handle}`} className={footerLinkClass}>
                  <span className="sr-only">Your public profile, </span>
                  <span className="font-mono">@{accountLabel(account)}</span>
                </Link>
              ) : null}
              <Link href="/dashboard/media" className={footerLinkClass}>
                Manage media
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={footerLinkClass}>
                Log in
              </Link>
              <Link href="/register" className={footerLinkClass}>
                Create account
              </Link>
              <Link href="/forgot-password" className={footerLinkClass}>
                Reset password
              </Link>
            </>
          )}
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="shell-wrap flex flex-col gap-1 py-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            &copy; {year} {BRAND.name}
          </span>
          <span>South Australian independent artists</span>
        </div>
      </div>
    </footer>
  );
}
