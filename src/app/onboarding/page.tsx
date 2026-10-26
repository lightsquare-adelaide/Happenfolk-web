import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { BRAND } from "@/lib/brand";
import { afterOnboardingPath } from "@/lib/onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: `Complete your profile · ${BRAND.name}` };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = afterOnboardingPath((await searchParams).next);
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
    redirect(nextPath);
  }

  return (
    <AuthShell
      pageKey="onboarding"
      title="Set up your profile"
      subtitle="Three decisions, then you are in: what kind of account this is, which category your work sits in, and the public address people will use to find you."
    >
      <OnboardingForm
        categories={categories ?? []}
        currentHandle={profile?.handle ?? null}
        nextPath={nextPath}
      />
    </AuthShell>
  );
}
