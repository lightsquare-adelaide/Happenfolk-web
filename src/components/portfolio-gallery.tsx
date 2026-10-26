"use client";

import { useId, useState } from "react";
import { secondaryButtonClass } from "@/components/field";

export type PortfolioMedia = {
  url: string;
  smallUrl: string | null;
  contentType: string;
  altText: string;
  width: number | null;
  height: number | null;
};

/** Adapted from the personal MediaCarousel; URLs are public derivatives only. */
export function PortfolioGallery({ title, media }: { title: string; media: PortfolioMedia[] }) {
  const [index, setIndex] = useState(0);
  const captionId = useId();
  if (!media.length) return null;
  const selected = Math.min(index, media.length - 1);
  const current = media[selected];
  return (
    <figure className="flex min-w-0 flex-col gap-3" aria-label={`Media for ${title}`}>
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden border border-line bg-surface">
        {current.contentType === "video/mp4" ? (
          <video key={current.url} controls playsInline preload="metadata"
            width={current.width ?? undefined} height={current.height ?? undefined}
            aria-label={current.altText || title} aria-describedby={captionId}
            className="h-full w-full object-contain">
            <source src={current.url} type="video/mp4" />
          </video>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- privacy-safe public derivative
          <img key={current.url} src={current.url} alt={current.altText}
            width={current.width ?? undefined} height={current.height ?? undefined}
            loading="lazy" className="h-full w-full object-contain" />
        )}
      </div>
      <figcaption id={captionId} className="break-words text-sm leading-6 text-muted">
        {current.altText}
      </figcaption>
      {media.length > 1 ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" className={secondaryButtonClass} aria-label={`Previous media for ${title}`}
              onClick={() => setIndex((selected - 1 + media.length) % media.length)}>Previous</button>
            <span role="status" className="text-sm text-muted">{selected + 1} of {media.length}</span>
            <button type="button" className={secondaryButtonClass} aria-label={`Next media for ${title}`}
              onClick={() => setIndex((selected + 1) % media.length)}>Next</button>
          </div>
          <ul className="flex min-w-0 flex-wrap gap-2" aria-label={`Choose media for ${title}`}>
            {media.map((asset, position) => (
              <li key={asset.url}>
                <button type="button" aria-label={`Media ${position + 1} for ${title}`}
                  aria-current={position === selected ? "true" : undefined}
                  className={`flex h-12 w-12 items-center justify-center overflow-hidden border bg-surface text-xs ${position === selected ? "border-foreground" : "border-line"}`}
                  onClick={() => setIndex(position)}>
                  {asset.contentType === "video/mp4" ? "Video" : (
                    // eslint-disable-next-line @next/next/no-img-element -- decorative thumbnail
                    <img src={asset.smallUrl ?? asset.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </figure>
  );
}
