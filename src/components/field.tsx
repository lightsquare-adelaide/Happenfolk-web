import type { ReactNode } from "react";

// Adapted from the user's shared form primitives: visible labels and one system.
export const inputClass =
  "block w-full min-w-0 rounded-none border border-line bg-background px-3 py-3 text-base text-foreground outline-offset-4 transition-colors focus:border-foreground disabled:cursor-not-allowed disabled:opacity-50";

const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap px-5 py-2.5 text-center text-sm font-medium outline-offset-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const primaryButtonClass = buttonClass +
  " border border-transparent bg-brand-700 text-white hover:brightness-95 dark:text-black";
export const secondaryButtonClass = buttonClass +
  " border border-line bg-background text-foreground hover:bg-surface";
export const dangerButtonClass = buttonClass +
  " border border-line bg-background text-red-700 hover:bg-surface dark:text-red-300";
export const cardClass = "border border-line bg-surface p-6";

export function Field({ label, hint, mono, className, children }: {
  label: string; hint?: string; mono?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <label className={"flex min-w-0 flex-col gap-2 text-sm font-medium " + (className ?? "")}>
      {label}
      <span className={"block min-w-0" + (mono ? " font-mono" : "")}>{children}</span>
      {hint ? <span className="text-sm font-normal leading-6 text-muted">{hint}</span> : null}
    </label>
  );
}
