"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseProfileForm } from "@/lib/profile";

export type ProfileState = { error: string | null; saved: boolean };

/**
 * Saves the caller's own profile. Authorization via getUser() (server
 * verified); the profiles RLS "own row" policy enforces the rest.
 */
export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = parseProfileForm(formData);
  if (parsed.error !== null) return { error: parsed.error, saved: false };

  const { error } = await supabase.from("profiles").update(parsed.value).eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That handle was just taken by someone else. Try another.", saved: false };
    }
    return { error: error.message, saved: false };
  }

  revalidatePath("/dashboard", "layout");
  return { error: null, saved: true };
}
