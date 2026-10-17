# Happenfolk brand mockups (proposal, 16 October 2026)

Proposal by Mabin, built from Brand Direction R1 (Marquee direction: palette §5, type §6,
wordmark §7, copy set §8). Yongzhe Shen (Design System Lead) owns the final mark, lockups
and component system and may change anything here.

- `logo/`: outlined SVGs (no font dependency): mark, wordmark, lockups (`currentColor`,
  black, white) and app icon. Mark: two figures joined at the hands make the H.
  Wordmark: Archivo wdth 125, wght 800.
- `mockups/`: static HTML. Open `index.html` (Newsfeed landing, signed out), `event.html`
  (gated event preview), `artist.html` (portfolio), `brand.html` (identity sheet).
  Theme follows the system setting; the half-circle button toggles it, `?theme=dark` forces it.

Photos are picsum.photos placeholders. Fonts and icons load from Google Fonts and unpkg
(Phosphor), so the pages need network access. Mockup-only choices open to change: square
corners (avatars round), Phosphor icons, spacing, breakpoints 768/1024, mobile tab bar.

## Known follow-ups

1. Replace placeholders with 8-10 images from the real 20-30 image catalogue.
2. Mobile search placeholder truncates; use "Search" below 768px.
3. Rank markers and event-detail icons use `aria-label` on `<span>`/`<i>`; use visually hidden text.
4. Mobile header: show "Create account" instead of "Sign in" (sign-in is already in the tab bar).
5. Decide whether rank markers below images breach brand rule 1 (accent next to artwork), and
   whether the 64px display cap should allow one larger hero size.
6. Minor: drop or replace the "Newsfeed" heading; centre lockups in brand-sheet tiles; add a
   date block to feed event cards so events stand out from posts.
