"use client";

import { useEffect, useRef } from "react";

/**
 * Fire-and-forget view recording for public detail surfaces (S2).
 *
 * Layering (cheapest guard first):
 * 1. sessionStorage suppression: one post per subject per 30-minute
 *    window per browser session — the same window as the DB dedupe, so
 *    honest re-renders/refreshes never reach the network. The store is
 *    BOUNDED (expired entries pruned, hard key cap with oldest-first
 *    eviction) and it is a traffic courtesy, NOT an authorization
 *    boundary: the DB per-identity dedupe inside record_page_view is
 *    the authority. Every storage access fails open (private mode,
 *    quota, serialization errors → still post once, never throw).
 * 2. The API itself (POST /api/views) enforces origin, strict body and
 *    trusted-identity rules; recording failures are swallowed — a view
 *    counter must never break the page or log console errors.
 *
 * Two placements:
 * - <ViewTracker>: page-level subjects (profile, event detail). Posts
 *   once per mount after the suppression check. Never blocks render,
 *   returns null.
 * - <WorkViewTracker>: portfolio items inside a gallery. Posts only
 *   when its sentinel actually enters the viewport, so off-screen
 *   works are not counted on mount. The observer disconnects after the
 *   first hit and on unmount; without IntersectionObserver support it
 *   falls back to posting (fail open, still DB-deduped).
 */

export type ViewSubjectType = "event" | "profile" | "portfolio_item";

const STORAGE_PREFIX = "happenfolk:views:";
const WINDOW_MS = 30 * 60 * 1000; // matches the DB dedupe window
const MAX_TRACKED_KEYS = 200;

function storageAvailable(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    // Probe: Safari private mode can throw on access/set.
    const probe = `${STORAGE_PREFIX}probe`;
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** True when this subject was already posted within the window. Fails open. */
function suppressed(subjectKey: string): boolean {
  const store = storageAvailable();
  if (!store) return false;
  try {
    const raw = store.getItem(STORAGE_PREFIX + subjectKey);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < WINDOW_MS;
  } catch {
    return false;
  }
}

/** Marks the subject, pruning expired keys and capping total growth. Fails open. */
function markSeen(subjectKey: string): void {
  const store = storageAvailable();
  if (!store) return;
  try {
    const now = Date.now();
    const tracked: { key: string; at: number }[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
      const at = Number(store.getItem(k));
      if (!Number.isFinite(at) || now - at >= WINDOW_MS) {
        store.removeItem(k); // prune expired/garbage while we are here
        continue;
      }
      tracked.push({ key: k, at });
    }
    tracked.sort((a, b) => a.at - b.at);
    while (tracked.length >= MAX_TRACKED_KEYS) {
      const oldest = tracked.shift();
      if (oldest) store.removeItem(oldest.key);
    }
    store.setItem(STORAGE_PREFIX + subjectKey, String(now));
  } catch {
    // quota or serialization trouble: counting stays best-effort
  }
}

/** Posts the view once per window; all failures are silent by design. */
export function recordView(subjectType: ViewSubjectType, subjectId: string): void {
  const subjectKey = `${subjectType}:${subjectId}`;
  if (suppressed(subjectKey)) return;
  markSeen(subjectKey);
  try {
    void fetch("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectType, subjectId }),
      keepalive: true,
    }).catch(() => {
      // view counting must never disturb the page
    });
  } catch {
    // fetch itself unavailable (ancient browser): skip silently
  }
}

/** Page-level tracker: posts once per mount (profile and event detail pages). */
export function ViewTracker({
  subjectType,
  subjectId,
}: {
  subjectType: ViewSubjectType;
  subjectId: string;
}) {
  useEffect(() => {
    recordView(subjectType, subjectId);
  }, [subjectType, subjectId]);
  return null;
}

/**
 * Gallery tracker for portfolio items: posts only when the work is
 * actually seen. Renders a zero-height sentinel (no layout impact) and
 * observes it; the observer disconnects after the first intersection
 * and on unmount, so no timers or observers leak.
 */
export function WorkViewTracker({ itemId }: { itemId: string }) {
  const sentinel = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      recordView("portfolio_item", itemId);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          recordView("portfolio_item", itemId);
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [itemId]);

  return (
    <span
      ref={sentinel}
      aria-hidden="true"
      data-work-view-sentinel={itemId}
      style={{ display: "block", width: "100%", height: 0, pointerEvents: "none" }}
    />
  );
}
