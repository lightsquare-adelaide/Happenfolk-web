import Link from "next/link";
import { BrandMark } from "@/components/logo";
import { primaryButtonClass, secondaryButtonClass } from "@/components/field";
import type { WorkCardData } from "@/components/discovery/data";

/**
 * Hero: one positioning line, two ways in, and a wall of real published work.
 * The wall only ever shows covers from the database; with none published it
 * becomes an honest, branded empty wall rather than sample art.
 */
export function Hero({ works }: { works: WorkCardData[] }) {
  const shown = works.filter((work) => work.coverUrl).slice(0, 3);
  return (
    <section aria-labelledby="home-title" className="border-b border-line">
      <div className="shell-wrap grid gap-10 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-20">
        <div className="min-w-0">
          <p className="mb-5 text-sm text-muted">Independent artists · South Australia</p>
          <h1 id="home-title" className="display-64">Where South Australian art gets seen.</h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-8 text-muted">
            Browse artists and their portfolios, and find events hosted by the people making the work. No account needed to look.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link prefetch={false} href="/artists" className={primaryButtonClass}>Browse artists</Link>
            <Link prefetch={false} href="/events" className={secondaryButtonClass}>See events</Link>
          </div>
        </div>
        <Wall works={shown} />
      </div>
    </section>
  );
}

function Wall({ works }: { works: WorkCardData[] }) {
  if (works.length === 0) {
    return (
      <div className="flex aspect-[4/3] min-w-0 flex-col justify-between border border-brand-line bg-brand-soft p-6 sm:p-8 lg:aspect-[5/6]">
        <BrandMark className="h-14 w-14 text-brand-text" />
        <div>
          <p className="display-32 md:display-48">The wall is waiting for its first work.</p>
          <p className="mt-3 max-w-[36ch] text-sm leading-6 text-muted">
            Published portfolio work appears here as artists share it.
          </p>
        </div>
      </div>
    );
  }
  const [lead, ...rest] = works;
  const sizes = "(min-width: 1280px) 280px, (min-width: 1024px) 23vw, calc((100vw - 52px) / 2)";
  return (
    <>
    <link rel="preload" as="image" href={lead.smallCoverUrl ?? lead.coverUrl!}
      media="(max-width: 600px)" fetchPriority="high" />
    <link rel="preload" as="image" href={lead.coverUrl!}
      imageSrcSet={lead.smallCoverUrl ? `${lead.smallCoverUrl} ${lead.smallWidth ?? 480}w, ${lead.coverUrl} ${lead.width ?? 1080}w` : undefined}
      imageSizes={sizes} media="(min-width: 601px)" fetchPriority="high" />
    <ul className={`grid min-w-0 gap-3 ${rest.length ? "grid-cols-2" : "grid-cols-1"} aspect-[4/3] lg:aspect-[5/6]`}>
      {[lead, ...rest].map((work, index) => {
        const href = /^[0-9a-f-]{36}$/i.test(work.id)
          ? `/items/${encodeURIComponent(work.id)}`
          : `/artists/${encodeURIComponent(work.artistHandle)}`;
        return (
        <li key={work.id} className={`relative min-w-0 overflow-hidden border border-line bg-tint ${index === 0 && rest.length ? "row-span-2" : ""}`}>
          <Link prefetch={false} href={href} className="group block h-full outline-offset-4">
            <picture>
              {work.smallCoverUrl ? <source media="(max-width: 600px)" srcSet={`${work.smallCoverUrl} ${work.smallWidth ?? 480}w`} sizes={sizes} /> : null}
              {/* Public bounded derivatives; picture selects the phone size. */}
              <img src={work.coverUrl!} alt={work.alt} width={work.width ?? 800} height={work.height ?? 1000}
                srcSet={work.smallCoverUrl ? `${work.smallCoverUrl} ${work.smallWidth ?? 480}w, ${work.coverUrl} ${work.width ?? 1080}w` : undefined}
                sizes={sizes} loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"} decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.03]" />
            </picture>
            <span className="absolute inset-x-0 bottom-0 bg-background px-3 py-2 text-xs leading-5">
              <span className="font-medium underline underline-offset-4">{work.title}</span>
              <span className="text-muted"> · {work.artistName}</span>
            </span>
          </Link>
        </li>
      );
      })}
    </ul>
    </>
  );
}
