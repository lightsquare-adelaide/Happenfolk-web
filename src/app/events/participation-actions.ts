"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { canRegisterWithoutPayment, isUuid, registrationErrorMessage } from "@/lib/registration";

export type RegistrationActionState = { error: string | null };

/** Submit a *free* published-event registration using the existing DB RPC. */
export async function registerForFreeEvent(
  _previous: RegistrationActionState,
  formData: FormData,
): Promise<RegistrationActionState> {
  const eventId = String(formData.get("eventId") ?? "");
  if (!isUuid(eventId)) return { error: "Invalid event." };

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/events/${eventId}/participate`)}`);

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, status, price_cents")
    .eq("id", eventId)
    .eq("status", "published")
    .maybeSingle();
  if (eventError) return { error: "Could not load this event. Please try again." };
  if (!event) return { error: "This event is no longer available for registration." };
  if (!canRegisterWithoutPayment(event)) {
    return { error: "Paid event checkout is not available yet. No payment was taken." };
  }

  // Until the capacity fix proposed in PR #30 merges, do not allow a cancelled
  // registration to re-enter via this UI: the old RPC misses the capacity check.
  const { data: existing, error: existingError } = await supabase
    .from("event_registrations")
    .select("id, status")
    .eq("member_id", user.id)
    .eq("event_id", eventId)
    .maybeSingle();
  if (existingError) return { error: "Could not check your registration. Please try again." };
  if (existing?.status === "cancelled") {
    return { error: "Re-registration after cancellation is temporarily unavailable." };
  }
  if (existing?.status === "confirmed" || existing?.status === "pending") {
    redirect("/dashboard/registrations?notice=already_registered");
  }

  // Existing DB SECURITY DEFINER function enforces event publication,
  // seat capacity, auth.uid() ownership, and repeat-click uniqueness.
  const { error } = await supabase.rpc("register_for_event", { p_event_id: eventId });
  if (error) return { error: registrationErrorMessage(error.message) };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/registrations");
  redirect("/dashboard/registrations?notice=registered");
}
