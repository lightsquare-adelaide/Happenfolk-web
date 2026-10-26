/**
 * Theme resolution for the manual light/dark toggle.
 *
 * Contract:
 *   - A stored choice ("light" or "dark") always wins.
 *   - With no stored choice the system preference decides, and the resolved
 *     value is still written to <html data-theme> so CSS only ever reads one
 *     attribute (see globals.css and the bootstrap script in layout.tsx).
 *   - Storage is optional. Private browsing, blocked site data and sandboxed
 *     previews must not throw, must not break the toggle, and must not persist.
 *
 * `resolveTheme` is pure so it can be unit tested without a DOM.
 */

export const THEME_STORAGE_KEY = "hf-theme";

export type Theme = "light" | "dark";

/** True for the only two values this module ever writes. */
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** Stored choice when it is one of ours, otherwise null. */
export function normaliseStored(value: string | null | undefined): Theme | null {
  return isTheme(value) ? value : null;
}

/** The theme to apply: stored choice first, then the system preference. */
export function resolveTheme(
  stored: string | null | undefined,
  systemPrefersDark: boolean,
): Theme {
  return normaliseStored(stored) ?? (systemPrefersDark ? "dark" : "light");
}

/** The other theme, for the toggle. */
export function invertTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/**
 * Inline pre-paint bootstrap. Runs before the first frame, so a returning
 * visitor with a stored dark choice never sees a white flash, and the server
 * rendered HTML (which carries no data-theme) never has to guess.
 *
 * Kept deliberately tiny and dependency free: it is inlined into every
 * document. <html> is rendered with suppressHydrationWarning because this
 * script adds an attribute React did not render.
 */
export const themeBootstrapScript = `(function(){var d=document.documentElement,t=null;try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(s==="light"||s==="dark")t=s;}catch(e){}if(!t){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}d.setAttribute("data-theme",t);})();`;

/* ------------------------------------------------------------ browser side */

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The theme currently applied to the document, or null before hydration. */
export function readAppliedTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  return normaliseStored(document.documentElement.getAttribute("data-theme"));
}

/** What this visitor explicitly chose, if anything. */
export function readStoredTheme(): Theme | null {
  const store = storage();
  if (!store) return null;
  try {
    return normaliseStored(store.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Paint a theme without recording it as the visitor's choice. */
export function setAppliedTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Apply and persist a choice. Persistence failures are swallowed: an applied
 * theme that could not be stored is still correct for this session.
 */
export function applyTheme(theme: Theme): void {
  setAppliedTheme(theme);
  if (typeof document === "undefined") return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Storage unavailable (private mode, quota, sandbox). Theme still applies. */
  }
}

/** Forget the stored choice so the system preference leads again. */
export function clearStoredTheme(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* Nothing to forget. */
  }
}

/**
 * Subscribe to theme changes from any source: this tab's toggle (observed on
 * the document element), another tab (storage event), or the operating system
 * while no explicit choice is stored.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  window.addEventListener("storage", onChange);

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    // Follow the system only while the visitor has not chosen a theme, and
    // without storing anything: an OS change is not a choice.
    if (readStoredTheme() == null) {
      setAppliedTheme(media.matches ? "dark" : "light");
    }
  };
  media.addEventListener("change", onSystemChange);

  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onSystemChange);
  };
}
