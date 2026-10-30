"use client";

import { useSyncExternalStore } from "react";
import {
  applyTheme,
  invertTheme,
  readAppliedTheme,
  subscribeToTheme,
  type Theme,
} from "@/lib/theme";

const getSnapshot = (): Theme | null => readAppliedTheme();

/**
 * During SSR and hydration there is no resolved theme to read, so the server
 * snapshot is null and both renders agree. The inline bootstrap script has
 * already set data-theme before first paint, so the real value arrives on the
 * first client render after hydration without a mismatch warning.
 */
const getServerSnapshot = (): Theme | null => null;

/**
 * Half-filled circle: the theme control from the team mockups (PR #22). One
 * geometric glyph, drawn from two primitives, so the shell adds no icon
 * dependency. The filled half flips side with the theme.
 */
function ThemeGlyph({ theme }: { theme: Theme | null }) {
  const dark = theme === "dark";
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" focusable="false">
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d={dark ? "M10 2a8 8 0 0 0 0 16z" : "M10 2a8 8 0 0 1 0 16z"}
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Manual light/dark control. The choice is persisted (see lib/theme.ts) and
 * applied before paint, so there is no flash and no hydration mismatch.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeToTheme, getSnapshot, getServerSnapshot);
  const label =
    theme === "dark"
      ? "Dark theme: switch to light theme"
      : theme === "light"
        ? "Light theme: switch to dark theme"
        : "Auto theme: switch colour theme";

  return (
    <button
      type="button"
      onClick={() => applyTheme(invertTheme(theme ?? "light"))}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 border border-line-strong px-2.5 text-foreground transition-colors duration-200 hover:border-brand hover:text-brand-text ${className}`}
      aria-label={label}
      title={label}
    >
      <ThemeGlyph theme={theme} />
      <span className="hidden text-xs font-semibold uppercase tracking-wide lg:inline">
        {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto"}
      </span>
    </button>
  );
}
