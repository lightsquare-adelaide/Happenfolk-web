"use client";

import Link from "next/link";
import { useState } from "react";

export type CollaborateProfile = {
  id: string;
  handle: string;
  display_name: string | null;
  account_kind: "individual" | "organisation";
  bio: string | null;
  contact_email: string | null;
  category_id: number | null;
  categoryName: string | null;
  avatarUrl: string | null;
};

type Category = {
  id: number;
  slug: string;
  name: string;
};

type Props = {
  profiles: CollaborateProfile[];
  categories: Category[];
  initialCategoryId?: number | null;
};

/**
 * Filterable directory grid for /collaborate.
 * Styled with the Happenfolk editorial design system (no GSAP).
 */
export function CollaborateGrid({
  profiles,
  categories,
  initialCategoryId = null,
}: Props) {
  const [activeCategory, setActiveCategory] = useState<number | null>(
    initialCategoryId,
  );

  const visible =
    activeCategory === null
      ? profiles
      : profiles.filter((p) => p.category_id === activeCategory);

  const pillBase =
    "inline-flex min-h-11 items-center border px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const pillOn = "border-foreground bg-foreground text-background";
  const pillOff = "border-line bg-surface text-foreground hover:border-foreground";

  return (
    <div>
      <div
        role="region"
        aria-label="Filter by discipline"
        className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5"
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            aria-pressed={activeCategory === null}
            className={`${pillBase} ${activeCategory === null ? pillOn : pillOff}`}
          >
            All · {profiles.length}
          </button>
          {categories.map((c) => {
            const count = profiles.filter((p) => p.category_id === c.id).length;
            const active = activeCategory === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(active ? null : c.id)}
                aria-pressed={active}
                className={`${pillBase} ${active ? pillOn : pillOff}`}
              >
                {c.name} · {count}
              </button>
            );
          })}
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
          Showing {visible.length} of {profiles.length}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="border border-line bg-surface p-10 text-center">
          <p className="font-display text-2xl">
            No practitioners currently listed in this discipline.
          </p>
          <p className="mt-2 text-sm text-muted">
            Switch back to all categories or opt in from your{" "}
            <Link
              href="/dashboard/profile"
              className="text-foreground underline underline-offset-4"
            >
              studio profile settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li
              key={p.id}
              data-collab-card
              className="flex flex-col justify-between border border-line bg-surface p-6 transition-colors hover:border-foreground"
            >
              <div>
                <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
                  <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                    {p.categoryName ?? "Uncategorised"}
                  </span>
                  <span className="border border-brand bg-brand/10 px-2 py-0.5 font-mono text-xs uppercase tracking-[0.12em] text-foreground">
                    Open
                  </span>
                </div>

                <div className="mt-5 flex items-center gap-3.5">
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public artist avatar
                    <img
                      src={p.avatarUrl}
                      alt={p.display_name ?? p.handle}
                      width={48}
                      height={48}
                      className="h-12 w-12 shrink-0 rounded-full border border-line object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-tint font-display text-lg"
                    >
                      {(p.display_name ?? p.handle).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <Link
                      href={`/artists/${encodeURIComponent(p.handle)}`}
                      className="block truncate font-display text-xl leading-tight text-foreground underline-offset-4 hover:underline"
                    >
                      {p.display_name ?? p.handle}
                    </Link>
                    <p className="truncate font-mono text-xs text-muted">
                      @{p.handle} ·{" "}
                      {p.account_kind === "organisation"
                        ? "Organisation"
                        : "Independent artist"}
                    </p>
                  </div>
                </div>

                {p.bio ? (
                  <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted">
                    {p.bio}
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 font-mono text-xs">
                <Link
                  href={`/artists/${encodeURIComponent(p.handle)}`}
                  className="uppercase tracking-[0.14em] text-foreground underline-offset-4 hover:underline"
                >
                  View portfolio →
                </Link>
                {p.contact_email ? (
                  <a
                    href={`mailto:${p.contact_email}?subject=${encodeURIComponent(`Collaboration enquiry via Happenfolk`)}`}
                    className="truncate text-muted underline decoration-line underline-offset-4 hover:text-foreground"
                  >
                    {p.contact_email}
                  </a>
                ) : (
                  <span className="text-muted">Contact via profile</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
