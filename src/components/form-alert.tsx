import type { ReactNode } from "react";

export type AlertTone = "danger" | "success" | "warning" | "info";

const TONES: Record<AlertTone, { box: string; role: "alert" | "status" }> = {
  danger: { box: "border-danger bg-danger-soft text-danger", role: "alert" },
  success: { box: "border-success bg-success-soft text-success", role: "status" },
  warning: { box: "border-warning bg-warning-soft text-warning", role: "status" },
  info: { box: "border-line-strong bg-tint text-foreground", role: "status" },
};

/**
 * Inline status message for forms and route level notices.
 *
 * A failure is announced with role="alert" so it interrupts a screen reader
 * the moment it appears; a confirmation uses role="status" so it is polite.
 * Colour is never the only signal: the message is real text, and the block is
 * set off by a rule and a tinted ground.
 *
 * Pass `id` and point a control's aria-describedby at it when the message
 * belongs to one specific field.
 */
export function FormAlert({
  tone = "danger",
  id,
  children,
}: {
  tone?: AlertTone;
  id?: string;
  children: ReactNode;
}) {
  const { box, role } = TONES[tone];
  return (
    <p
      id={id}
      role={role}
      className={`border-l-2 px-3 py-2 text-sm leading-6 ${box}`}
    >
      {children}
    </p>
  );
}
