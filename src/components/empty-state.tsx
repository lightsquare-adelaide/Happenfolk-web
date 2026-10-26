import Link from "next/link";
import { secondaryButtonClass } from "./field";

// Reuse the user's gallery empty-state pattern with the team's square geometry.
export function EmptyState({ title, hint, action }: {
  title: string; hint?: string; action?: { href: string; label: string };
}) {
  return (
    <div className="flex min-h-52 min-w-0 flex-col items-start justify-center gap-4 border border-dashed border-line bg-surface p-6 sm:p-8">
      <span aria-hidden="true" className="block h-4 w-4 border border-line" />
      <p className="break-words text-lg font-medium">{title}</p>
      {hint ? <p className="max-w-md text-sm leading-7 text-muted">{hint}</p> : null}
      {action ? <Link prefetch={false} href={action.href} className={secondaryButtonClass}>{action.label}</Link> : null}
    </div>
  );
}
