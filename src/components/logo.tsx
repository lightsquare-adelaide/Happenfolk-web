import { BRAND } from "@/lib/brand";

/**
 * Brand mark and lockup.
 *
 * Geometry is the team mark from PR #22 / #27
 * (docs/design/brand-mockups/logo/happenfolk-mark.svg, also shipped as
 * public/happenfolk-mark.svg in PR #27): two heads above a joined pair of
 * arms that read as an H, on a 48 x 48 grid. It is inlined here rather than
 * referenced as a file so it inherits currentColor and follows the theme
 * without a second request or a hardcoded fill.
 *
 * The wordmark is live text in the display face (condensed Archivo, uppercase)
 * instead of the outlined SVG lockup, so it stays selectable, translatable and
 * free of a large path payload.
 */
export function BrandMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11" cy="9" r="5" />
      <circle cx="37" cy="9" r="5" />
      <path d="M6 18H16V26H32V18H42V44H32V32H16V44H6Z" />
    </svg>
  );
}

/**
 * Lockup: mark plus wordmark. The wordmark drops below 380px so the mark,
 * the theme control and the menu button always have room at 320px.
 */
export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const mark = size === "lg" ? "h-8 w-8" : size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const word = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-xl";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BrandMark className={`${mark} shrink-0 text-foreground`} />
      <span
        className={`${word} font-display hidden truncate font-extrabold uppercase leading-none tracking-tight text-foreground min-[380px]:block`}
      >
        {BRAND.name}
      </span>
    </span>
  );
}
