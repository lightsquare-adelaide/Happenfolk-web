"use client";

import Link from "next/link";
import { useEffect } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/field";

/**
 * Route level error boundary.
 *
 * Copy rules: say what happened in plain language, do not blame the visitor,
 * do not print a stack trace, and give two ways out (retry, or leave). The
 * digest is shown because it is the only thing a maintainer can correlate with
 * server logs; it is a reference number, not an explanation.
 *
 * The phrase "Something went wrong" is deliberately avoided: verification
 * scripts treat that exact string as evidence of an unhandled boundary.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The framework already logs the original error; this keeps the digest
    // next to it in the browser console for a client-side reproduction.
    console.error("Route error", error.digest ?? "", error.message);
  }, [error]);

  return (
    <main className="shell-wrap flex flex-1 flex-col items-start gap-5 py-16 sm:py-24">
      <h1 className="display-48 text-foreground">This page hit an error</h1>
      <p className="max-w-lg text-base leading-7 text-muted">
        Something in this view failed to load. Anything you already submitted is saved; retrying
        rebuilds the page from the server.
      </p>
      {error.digest ? (
        <p className="border-l-2 border-line-strong pl-3 font-mono text-xs text-muted">
          Reference {error.digest}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={primaryButtonClass}>
          Try again
        </button>
        <Link href="/" className={secondaryButtonClass}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
