"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleProblem, isValidAccountKind } from "@/lib/onboarding";

export type OnboardingState = { error: string | null };

/**
 * Completes onboarding: account kind + category + handle on the
 * caller's own profile row. Authorization via getUser() (server
 * verified); the profiles RLS "own row" policy enforces the rest.
 */
export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const handle = String(formData.get("handle") ?? "");
  const kind = String(formData.get("accountKind") ?? "");
  const categoryId = Number(formData.get("categoryId"));

  const problem = handleProblem(handle);
  if (problem) return { error: problem };
  if (!isValidAccountKind(kind)) return { error: "Choose an account type" };
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return { error: "Choose a category" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ handle, account_kind: kind, category_id: categoryId })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That handle was just taken by someone else. Try another." };
    }
    return { error: error.message };
  }

  redirect("/dashboard");
}
