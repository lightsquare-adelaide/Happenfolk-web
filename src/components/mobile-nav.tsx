"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "./field";
import { PRIMARY_NAV, Z } from "./nav-items";

export type MobileAccount = {
  signedIn: boolean;
  handle: string | null;
  shortId: string | null;
};

const linkClass =
  "block min-w-0 truncate border-l-2 border-transparent px-3 py-3 text-base text-foreground transition-colors duration-200 hover:border-brand hover:bg-tint";

/**
 * Narrow-screen navigation (below 768px).
 *
 * Why it exists: the signed-in header used to render the wordmark, three
 * section links, a 30-character handle and Log out on one line, which pushed
 * the document to 465px inside a 390px viewport. A disclosure is the real fix;
 * the handle never renders inline on a phone, and every row truncates inside a
 * min-w-0 flex child instead of widening the page.
 *
 * Semantics: a disclosure, not a dialog. A real <button> drives it, so it is
 * keyboard operable without extra work; aria-expanded and aria-controls state
 * the relationship; Escape closes and returns focus to the button; focus moves
 * into the panel on open and tabs back out into the page (no trap, which would
 * be wrong for a disclosure); a click outside closes; navigation closes.
 *
 * The panel has no enter animation. That is deliberate: it keeps reduced-motion
 * respect trivial, avoids focus landing on a moving target, and keeps the
 * header height stable while the panel is open.
 */
export function MobileNav({ account }: { account: MobileAccount }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close on navigation. Render-time adjustment (no effect, no extra render
  // pass) is the pattern React recommends for a derived reset.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    // Lock page scroll while the disclosure is open. scrollbar-gutter: stable
    // on <html> keeps the gutter reserved, so nothing shifts sideways.
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    return () => {
      document.documentElement.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const handle = account.handle ?? account.shortId;

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="site-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center border text-foreground transition-colors duration-200 ${
          open ? "border-brand text-brand-text" : "border-line-strong hover:border-brand"
        }`}
      >
        <svg
          viewBox="0 0 20 20"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          focusable="false"
        >
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="square" />
          ) : (
            <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="square" />
          )}
        </svg>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="site-nav-panel"
          className={`absolute inset-x-0 top-full border-b border-line bg-surface shadow-[0_24px_40px_-32px_rgb(11_11_12/0.55)] ${Z.mobilePanel}`}
        >
          <nav aria-label="Mobile" className="shell-wrap flex flex-col py-3">
            {PRIMARY_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={`${linkClass} ${active ? "border-brand font-semibold" : ""}`}
                >
                  {item.label}
                </Link>
              );
            })}

            <div className="my-3 border-t border-line" />

            {account.signedIn ? (
              <>
                <Link href="/dashboard" className={`${linkClass} flex items-baseline gap-2`}>
                  <span className="shrink-0 text-muted">Dashboard</span>
                  {handle ? (
                    <span className="min-w-0 truncate font-mono text-sm">@{handle}</span>
                  ) : null}
                </Link>
                {account.handle ? (
                  <Link href={`/artists/${account.handle}`} className={linkClass}>
                    View public profile
                  </Link>
                ) : null}
                <form action="/auth/signout" method="post" className="px-3 pt-2">
                  <button type="submit" className={`${secondaryButtonClass} w-full`}>
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <div className="flex flex-col gap-2 px-3 pt-1">
                <Link href="/login" className={`${secondaryButtonClass} w-full`}>
                  Log in
                </Link>
                <Link href="/register" className={`${primaryButtonClass} w-full`}>
                  Create account
                </Link>
              </div>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
