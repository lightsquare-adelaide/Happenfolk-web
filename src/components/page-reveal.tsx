"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Post-navigation transition (src/app/template.tsx renders this).
 *
 * The animation is applied only to client-side navigations. A module level
 * flag is read in the state initializer (never written during render, so
 * StrictMode double invocation is harmless) and set after commit: the first
 * document paint therefore has no entry animation at all, which keeps the LCP
 * element visible immediately, and every later navigation fades in.
 *
 * Reduced motion is handled in CSS: the .page-reveal rule only exists inside
 * a prefers-reduced-motion: no-preference block, so this class is inert there.
 */
let hasMountedBefore = false;

export function PageReveal({ children }: { children: ReactNode }) {
  const [animate] = useState(() => hasMountedBefore);

  useEffect(() => {
    hasMountedBefore = true;
  }, []);

  return (
    <div className={`flex flex-1 flex-col ${animate ? "page-reveal" : ""}`}>{children}</div>
  );
}
