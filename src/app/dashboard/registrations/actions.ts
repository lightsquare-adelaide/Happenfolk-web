"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid, registrationErrorMessage } from "@/lib/registration";

export type CancelState = { error: string | null };

export async function cancelMyRegistration(
  _previous: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const id = String(formData.get("registrationId") ?? "");
  if (!isUuid(id)) return { error: "Invalid registration." };
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fdashboard%2Fregistrations");

  const { data: current, error: readError } = await supabase
    .from("event_registrations")
    .select("status")
    .eq("id", id)
    .eq("member_id", user.id)
    .maybeSingle();
  if (readError) return { error: "Could not read your registration. Try again." };
  if (!current) return { error: "Registration not found." };
  if (current.status === "cancelled") return { error: "This registration is already cancelled." };

  const { error } = await supabase.rpc("cancel_registration", { p_registration_id: id });
  if (error) return { error: registrationErrorMessage(error.message) };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/registrations");
  redirect("/dashboard/registrations?notice=cancelled");
}
