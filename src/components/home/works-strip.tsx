import { WorkTile } from "@/components/discovery/cards";
import type { WorkCardData } from "@/components/discovery/data";

/**
 * A swipeable strip of recent published covers. Plain CSS scroll snap: no
 * script, keyboard focusable, and it scrolls inside its own box so the page
 * itself never overflows sideways.
 */
export function WorksStrip({ works }: { works: WorkCardData[] }) {
  return (
    <div role="region" aria-label="Recent published works" tabIndex={0}
      className="-mx-5 overflow-x-auto px-5 pb-4 outline-offset-4 sm:-mx-8 sm:px-8 lg:mx-0 lg:px-0">
      <ul className="flex snap-x snap-mandatory gap-5">
        {works.map((work, index) => (
          <li key={work.id} className="w-[58vw] max-w-64 shrink-0 snap-start sm:w-56 lg:w-60">
            <WorkTile work={work} eager={index < 3} />
          </li>
        ))}
      </ul>
    </div>
  );
}
