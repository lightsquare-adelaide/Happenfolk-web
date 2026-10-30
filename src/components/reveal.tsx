"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll reveal for section level content.
 *
 * IntersectionObserver only: no animation library, no scroll listener, no
 * layout thrash. Motion is opacity and transform, driven by the .reveal-*
 * classes in globals.css, which exist only inside a
 * prefers-reduced-motion: no-preference block. A reduced-motion session (or a
 * browser without IntersectionObserver) renders the end state immediately, and
 * the server rendered HTML always contains the full content.
 *
 * Motivation: sections below the fold arrive as the visitor reaches them,
 * which gives a long editorial page a reading rhythm. It is not decoration for
 * its own sake, so keep it to section wrappers and never to body copy.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Stagger in milliseconds for a sequence of sibling reveals. */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      // Deferred a frame: a synchronous setState in an effect cascades renders
      // (react-hooks/set-state-in-effect), and the visitor sees no difference.
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setShown(true);
        }
      },
      { rootMargin: "0px 0px -8%" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} ${shown ? "reveal-shown" : "reveal-pending"}`}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
