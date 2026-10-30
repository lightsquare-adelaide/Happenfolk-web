import type { ReactNode } from "react";
import { attributionLine, artworkSrc, pickArtwork } from "@/lib/artwork";

/**
 * Shared shell for the member entry surfaces: login, register, password reset
 * and onboarding.
 *
 * Architecture reused from the user's Lightsquare frontend (auth-shell.tsx),
 * retinted to the Happenfolk brand and simplified in one important way: the
 * artwork now comes from public/artwork (curated, attributed, local) instead of
 * a storage bucket, so the aside cannot fail a HEAD request, cannot 404 into a
 * console error, and needs no network to look right.
 *
 * Layout: one column on phones, form plus a quiet credited artwork on the
 * right from lg. The image is never the LCP element and never carries an
 * overlay, a pill or a caption printed on top of it (brand rule: the accent
 * does not sit on artwork).
 *
 * The artwork is a background image, not an <img>. Two reasons: a hidden
 * <img loading="lazy"> is never fetched, so it stays an incomplete image node
 * that verification scripts correctly report as broken; and a background on a
 * display:none subtree is not requested at all, so phones never download an
 * image they cannot see. Semantics are preserved with role="img" plus the same
 * objective alt text, and the credit is real text underneath.
 */
export function AuthShell({
  title,
  subtitle,
  pageKey,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Stable key so each surface keeps the same artwork between visits. */
  pageKey: string;
  children: ReactNode;
}) {
  const artwork = pickArtwork(pageKey);

  return (
    <main className="shell-wrap flex flex-1 flex-col gap-12 py-10 sm:py-14 lg:grid lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-20">
      <section className="flex w-full flex-col gap-7">
        <header className="flex flex-col gap-3">
          <h1 className="display-48 text-foreground">{title}</h1>
          {subtitle ? (
            <p className="max-w-md text-base leading-7 text-muted">{subtitle}</p>
          ) : null}
        </header>
        {children}
      </section>

      <aside className="hidden lg:block" aria-label="Reference artwork">
        <figure className="flex max-w-[26rem] flex-col gap-3">
          <span
            role="img"
            aria-label={artwork.alt}
            className="block aspect-[4/5] w-full border border-line bg-tint bg-cover bg-center"
            style={{ backgroundImage: `url(${artworkSrc(artwork)})` }}
          />
          <figcaption className="flex flex-col gap-1 text-xs leading-5 text-muted">
            <span>{attributionLine(artwork)}</span>
            <span>Public-domain reference artwork, not a member portfolio.</span>
          </figcaption>
        </figure>
      </aside>
    </main>
  );
}
