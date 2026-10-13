import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Complete your profile — Lightsquare" };

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();

  // HARD RULE: authorization via getUser() (server verified).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: categories }] = await Promise.all([
    supabase.from("profiles").select("handle, category_id").eq("id", user.id).maybeSingle(),
    supabase.from("categories").select("id, name").order("sort_order"),
  ]);

  if (profile && profile.category_id != null) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Complete your profile</h1>
      <p className="max-w-sm text-sm text-muted">
        Choose your account type and category, and pick a public handle. You can’t reach the
        dashboard until this is done.
      </p>
      <OnboardingForm categories={categories ?? []} currentHandle={profile?.handle ?? null} />
    </main>
  );
}
