"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Newsfeed" },
  { href: "/events", label: "Events" },
  { href: "/artists", label: "Artists" },
];

const current = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav-links" aria-label="Primary">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(path, l.href) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function TabBar({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const tabs = [...LINKS, signedIn ? { href: "/dashboard", label: "You" } : { href: "/login", label: "Sign in" }];
  return (
    <nav className="tabbar" aria-label="Mobile">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current(path, t.href) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
