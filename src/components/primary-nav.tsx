"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV } from "./nav-items";

/**
 * Desktop primary navigation. The current section is marked with
 * aria-current="page" and a rose rule, the mockups' active treatment.
 *
 * prefetch={false}: these routes are delivered by the discovery and events
 * packages, so prefetching them from this shell would request paths that do
 * not exist yet and surface as failed requests during verification.
 */
export function PrimaryNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={`items-center gap-1 ${className}`}>
      {PRIMARY_NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`flex h-16 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
              active
                ? "border-brand text-foreground"
                : "border-transparent text-muted hover:border-line-strong hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
