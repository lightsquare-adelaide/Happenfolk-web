import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "@/components/field";
import { BrandMark } from "@/components/logo";
import { BRAND } from "@/lib/brand";

/**
 * 404 for the whole app.
 *
 * A missing address here usually means an unpublished or renamed profile, so
 * the copy says that instead of blaming the visitor. Two exits, one intent
 * each: home for browsing, dashboard for a member (which sends a signed-out
 * visitor to /login through the existing middleware gate).
 */
export default function NotFound() {
  return (
    <main className="shell-wrap flex flex-1 flex-col items-start gap-6 py-16 sm:py-24">
      <BrandMark className="h-8 w-8 text-brand" />
      <h1 className="display-64 text-foreground">Not found</h1>
      <p className="max-w-xl text-base leading-7 text-muted">
        No page, profile or event on {BRAND.name} answers to this address. An artist can unpublish
        a profile or change a handle, and an event can be cancelled, which both retire a link that
        used to work.
      </p>
      <div className="mt-1 flex flex-wrap gap-3">
        <Link href="/" className={primaryButtonClass}>
          Back to home
        </Link>
        <Link href="/dashboard" className={secondaryButtonClass}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
