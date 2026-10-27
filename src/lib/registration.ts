/** Pure presentation/validation helpers for event participation (FR-REG). */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type PublicEvent = { status: string; price_cents: number };

/** The current backend supports a payment *stub*, not real-money checkout. */
export function canRegisterWithoutPayment(event: PublicEvent): boolean {
  return event.status === "published" && event.price_cents === 0;
}

/** Keep raw Postgres/Supabase errors out of the UI. */
export function registrationErrorMessage(message: string): string {
  if (message.includes("EVENT_FULL")) return "This event has no places left.";
  if (message.includes("EVENT_NOT_FOUND_OR_NOT_PUBLISHED")) {
    return "This event is no longer available for registration.";
  }
  if (message.includes("AUTH_REQUIRED")) return "Please sign in to continue.";
  if (message.includes("REGISTRATION_NOT_FOUND_OR_NOT_YOURS")) {
    return "This registration is no longer available to your account.";
  }
  return "We couldn't update your registration. Please try again.";
}
