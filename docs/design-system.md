# Happenfolk design system (package D)

Owner: package D (design system and application shell).
Baseline: `fix/audit-bugs` at `777a55d` (verified F, PR #30), branch `feat/design-system`.
References: `DESIGN-REFS.md` (task directory), team brand mockups in PR #22
(`docs/design/brand-mockups/mockups/styles.css`), the clickable prototype in PR #23,
the preview in PR #27, and the user's Lightsquare frontend as the component-quality source.

This document is the contract other packages build on. If a rule here and a rule in
your package brief disagree, this document wins for anything visual; the brief wins
for scope.

## 1. Design read and dials

Reading this as: a product shell for an artist showcase platform (public discovery
chrome, member auth and onboarding, dashboard chrome) for independent South Australian
artists and their audience, with an editorial gallery language: square corners, one
restrained rose accent, condensed Archivo display over Instrument Sans body.

- `DESIGN_VARIANCE: 6`. Editorial asymmetry on auth and error surfaces; strict single
  column below 768px.
- `MOTION_INTENSITY: 4`. Post-navigation reveal and scroll reveal only. No GSAP: nothing
  in the shell motivates pin or scrub work, and the skill bans GSAP-for-show. Motion is
  CSS plus IntersectionObserver, transform and opacity only.
- `VISUAL_DENSITY: 4`, dashboard 5. Hairlines and spacing group content; cards are used
  only where a surface really is elevated.

## 2. Type

Two webfonts, both self-hosted variable fonts under `public/fonts/` with their OFL
licence files and `public/fonts/font-sources.json` (URLs and SHA256 of the originals).
No third voice: the old Geist/Geist Mono download is gone. Handles and other identifiers
use the system monospace stack, which is not a downloaded face.

| Role | Face | Utility | Notes |
|---|---|---|---|
| Display | Archivo, wdth 62-125, wght 400-800 | `font-display` | Sets family **and** `font-stretch: 62%`. The condensed look is the real wdth axis, never `transform: scaleX`. |
| Body | Instrument Sans, wght 400-700 | `font-sans` | Also the `body` default. |
| Identifiers | system monospace | `font-mono` | Handles, digests, reference numbers. |

`next/font/local` registers Archivo with `declarations: [{ prop: "font-stretch", value: "62% 125%" }]`,
so the face is matched across the whole width range. Verified in a real browser: a 100px
probe string measures narrower at 62% than at 100% and wider at 125% (`logs-D/shell-checks-*.json`,
group `fonts`).

Display sizes follow the brand rule of three steps, each one step down under 768px:

| Class | >= 768px | < 768px |
|---|---|---|
| `.display-64` | 64px | 48px |
| `.display-48` | 48px | 32px |
| `.display-32` | 32px | 24px |

All three are uppercase, weight 800, `line-height: 1.05`. Unstyled `h1`-`h3` already get
the display face at weight 700, normal case, so a page that forgets a class is still on
brand; explicit utilities always win.

## 3. Colour

One accent: rose. It appears in exactly three roles.

1. A fill carrying contrasting ink: light `#E5006D` with white ink (4.61:1), dark
   `#FF3D8B` with near-black ink (5.89:1). Tokens `bg-brand` + `text-on-brand`.
2. Accent text and links: light `#C40060` (5.97:1 on white), dark `#FF3D8B` (5.89:1 on
   the ground). Token `text-brand-text`; the legacy `text-brand-700` maps to the same
   values per theme.
3. The focus ring: 3px, `--ring`, offset 2px, both themes.

Rose never sits on artwork, never becomes a second highlight colour, and the mockups'
acid rank colour is not imported. Lime from the user's version is not imported either.

Neutrals come from the brand sheet: white ground and near-black ink in light,
`#0B0B0C` ground and `#F4F4F5` ink in dark, `#F4F4F5`/`#202024` tint, `#D4D4D8`/`#27272A`
hairlines. `--line-strong` (`#84848C` / `#63636C`) is the boundary of a control and is
held at 3:1 or better against the ground in both themes; `--line` is for decoration only.

Status colours are semantic tokens, each at 4.5:1 or better on the ground and on its own
soft background in both themes: `danger` `#B42318`/`#FF8F85`, `success` `#166534`/`#4ADE80`,
`warning` `#8A5300`/`#F5C24B`, with `-soft` grounds and `on-danger` ink.

### 3.1 Light and dark

Theme resolution: stored choice (`localStorage["hf-theme"]`), else the system preference.
An inline bootstrap script (`lib/theme.ts: themeBootstrapScript`, first child of `<body>`)
sets `data-theme` before first paint, so there is no flash; `<html>` carries
`suppressHydrationWarning` for that one attribute only. Colours are declared once with
`light-dark()` and flip through `color-scheme`, so native controls follow too. The
`dark:` Tailwind variant is re-pointed at `[data-theme="dark"]` via `@custom-variant`.
Storage failures (private mode, blocked site data) degrade to "system preference, not
persisted" instead of throwing.

Measured, not assumed: with a stored dark choice, `data-theme` is set at ~23ms and the
browser's first paint entry is at ~60ms (`logs-D/shell-checks-*.json`, group `theme`).

### 3.2 Compatibility overrides

A few surfaces owned by other packages still hardcode Tailwind palette status colours
(`text-red-600`, `bg-green-100 text-green-800`). Under `[data-theme="dark"]` this file
redefines `--color-red-600`, `--color-red-700`, `--color-green-700`, `--color-green-800`,
`--color-green-100`, `--color-amber-800`, `--color-amber-100` so that legacy text stays
at 4.5:1 or better. When those surfaces adopt `text-danger` / `text-success` the overrides
can be deleted.

Known follow-up for the lead: `src/app/dashboard/profile/profile-form.tsx` and
`src/components/avatar-upload.tsx` still pair `bg-brand-700` with hardcoded `text-white`.
In dark mode that is 3.34:1. No single rose can be 4.5:1 against both white and near-black,
so those two buttons must switch to `primaryButtonClass` (rose fill + `text-on-brand`).
Package D does not own those files.

## 4. Shape, space, layers

- Radius: the whole Tailwind radius scale is zeroed in `@theme`. Square corners are the
  brand; `rounded-full` is not part of that scale and stays circular for avatars only.
  Existing `rounded-md` / `rounded-lg` markup in other packages therefore renders square
  without edits. New code should not add `rounded-*` classes except `rounded-full` on
  avatars.
- Shell container: `shell-wrap` (`max-width: var(--shell-max)`, 80rem; gutter 1.25rem,
  2rem from 40rem up). The header, the footer and every page container use it, so chrome
  and content share one left edge. Pages must not add their own `max-w-*` + padding
  wrapper.
- Header: sticky, 64px tall, solid `bg-background`, hairline below. Z-index scale:
  content 0, header 40, mobile disclosure 50, skip link 60. No other layers.
- Buttons: 44px minimum height (`min-h-11`), square, one label per intent. "Create
  account" is the sign-up label everywhere (header, auth pages, footer); "Log in" is the
  sign-in label everywhere.

## 5. Motion

- Post-navigation transition: `src/app/template.tsx` renders `PageReveal`, a 200ms
  opacity/translate entry. It runs on client-side navigations only; the first document
  paint carries no animation, so the LCP element is visible immediately.
- Scroll reveal: `components/reveal.tsx`, IntersectionObserver, opacity and transform,
  once per element.
- Reduced motion: a global `prefers-reduced-motion: reduce` block zeroes every animation
  and transition; the `.page-reveal` and `.reveal-*` rules only exist inside a
  `no-preference` block, so a reduced-motion session renders end states. A `<noscript>`
  style keeps reveal content visible without JavaScript.
- No scroll listeners, no `window.scrollY` state, no marquees, no parallax.

## 6. Components

Shared, exported, and stable for E, P, S and X:

| File | Exports | Contract |
|---|---|---|
| `components/field.tsx` | `inputClass`, `selectClass`, `textareaClass`, `primaryButtonClass`, `secondaryButtonClass`, `dangerButtonClass`, `cardClass`, `Field({ label, hint, mono, className, children })` | Label above the control, optional hint below. Because the label wraps the control, a field's accessible name is label text plus hint: keep hints out of fields addressed by exact name (login and register email carry none). |
| `components/empty-state.tsx` | `EmptyState({ title, hint?, action?: { href, label } })` | One sentence for what is missing, one optional hint, one way forward. |
| `components/form-alert.tsx` | `FormAlert({ tone, id, children })` | `danger` announces with `role="alert"`, the rest with `role="status"`. Colour is never the only signal. |
| `components/auth-shell.tsx` | `AuthShell({ title, subtitle, pageKey, children })` | One column on phones; from `lg`, form plus a quiet credited artwork. The artwork is a background image on a `role="img"` frame, so phones neither see nor download it and no incomplete `<img>` node exists. |
| `components/logo.tsx` | `BrandMark`, `Logo` | Team mark geometry from PR #22 / #27 (two heads above joined arms, 48x48), inlined with `currentColor`. Wordmark is live text in the display face. |
| `components/site-header.tsx`, `site-footer.tsx` | `SiteHeader`, `SiteFooter` | One cached `getCurrentAccount()` per request (`lib/current-account.ts`), authorization via `getUser()`. |
| `components/mobile-nav.tsx` | `MobileNav({ account })` | Disclosure below 768px. Escape closes and restores focus, focus moves in on open, outside click and navigation close, page scroll locks while open. No enter animation. |
| `components/primary-nav.tsx` | `PrimaryNav` | Desktop links with `aria-current="page"`. |
| `components/theme-toggle.tsx` | `ThemeToggle` | Half-circle glyph from the mockups; `useSyncExternalStore`, no hydration mismatch. |
| `components/reveal.tsx` | `Reveal({ children, className, delay })` | See Motion. |
| `components/page-reveal.tsx` | `PageReveal` | See Motion. |

`components/field.tsx` and `components/empty-state.tsx` are owned by the lead's D-ui
split. Package D verified against an untracked reference implementation (saved at
`taskdir/d-ui-reference-stubs/`) and imports the contract above; the lead's commit is
cherry-picked into this branch. If the lead's version keeps Lightsquare's `rounded-full`
buttons, replace them with the square strings from the reference stub: pills are off brand
here.

### 6.1 Navigation and deferred routes

`/discover`, `/artists` and `/events` are supplied by the S and E packages. Until they
land, the links resolve to the designed 404 page, and every one of them sets
`prefetch={false}` so the browser does not prefetch missing routes and report failed
requests during verification. Do not invent Layer 3 destinations in the shell.

## 7. Artwork and credits

`public/artwork/` holds three public-domain works preserved from the project's existing
local source cache and visually inspected on 2026-10-26: Matisse "Still Life with
Geranium" (1906), Mondrian "Lozenge Composition with Yellow, Black, Blue, Red, and Gray"
(1921), Hartley "Movement" (1913), all CC0 via the Art Institute of Chicago. The external
endpoint returned HTTP 403 that day, so no fresh revalidation is claimed; the preserved
manifest attribution stands. `docs/design/artwork-sources.json` carries the full record;
`src/lib/artwork.ts` is the single source of truth in code and `src/lib/artwork.spec.ts`
fails the build if an entry loses its alt text, credit or file.

Policy:

- Alt text describes the pixels as inspected, never the old manifest title.
- Every placement prints a credit line: title, artist, year, institution, licence.
- These are historical works by named artists. They are labelled "Public-domain
  reference artwork, not a member portfolio" and must never appear as a member's work.
- Portrait-category photographs from the wider cache stay reserved for avatar and craft
  context (package X seeding), not for shell decoration.
- The `/credits` page belongs to package X. When it exists, the auth-shell caption is the
  place to link it.

## 8. Verification

Commands and evidence live in `taskdir/logs-D/` and `taskdir/screens-D/`:

- `d-shell-checks.mjs`: 87 assertions after JavaScript runs (font axis reality, theme
  before paint, dark-mode button ink, overflow at 320/390/768/1024/1440 on six routes,
  disclosure keyboard semantics, skip link handoff, label association, focus ring,
  reduced motion, artwork decode and credit, deferred-route 404 inside the shell).
- `capture.mjs`: four modes (desktop light, mobile light, desktop dark, mobile reduced)
  over `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`.
- `journey.mjs`: full UI journey including the 30-character handle case that used to push
  the signed-in mobile header to 465px. The fix is structural (disclosure plus truncating
  `min-w-0` handle), not `overflow-x: hidden`.

## 9. Out of scope for D, on purpose

- `src/app/page.tsx` (S), `src/app/artists/**`, `src/app/dashboard/page.tsx`,
  `src/app/dashboard/profile/**`, `src/components/avatar-upload.tsx`,
  `src/components/media-panel.tsx` (P): untouched, they inherit tokens automatically.
- Legal, privacy, licence and `/credits` pages and their footer links (X). The footer
  has an obvious insertion point; a link to a route that does not exist is worse than no
  link.
- `package.json` name still reads `lightsquare-web`; renaming is a launch-readiness
  decision, not a design one.
