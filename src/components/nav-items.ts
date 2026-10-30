export type NavItem = { href: string; label: string };

/**
 * Primary navigation for the shell.
 *
 * These three destinations are supplied by the discovery (S) and events (E)
 * packages on top of this shell: /discover and /artists are the S directory
 * surfaces, /events is the E public listing. Until they land in the same
 * build the links resolve to the designed 404 page, so every link here sets
 * prefetch={false} (see PrimaryNav and MobileNav) to keep the browser from
 * prefetching routes that do not exist yet and reporting them as errors.
 *
 * Nothing in this list is invented: it mirrors the confirmed Layer 1 scope
 * (discovery, artist categories, events). No Layer 3 surface is linked.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/discover", label: "Discover" },
  { href: "/artists", label: "Artists" },
  { href: "/events", label: "Events" },
];

/**
 * Layer stack for the shell. Kept in one place so a new overlay never guesses
 * a number: content 0, sticky header 40, mobile disclosure 50, skip link 60.
 */
export const Z = {
  header: "z-40",
  mobilePanel: "z-50",
  skipLink: "z-[60]",
} as const;
