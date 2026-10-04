import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";
import { ProfileForm } from "./profile-form";

export const metadata = { title: `Edit profile — ${BRAND.name}` };

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();

  // HARD RULE: authorization via getUser() (server verified).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: categories }] = await Promise.all([
    supabase
      .from("profiles")
      .select("handle, display_name, account_kind, category_id, bio, published")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("categories").select("id, name").order("sort_order"),
  ]);

  if (profile == null || profile.category_id == null) redirect("/onboarding");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Edit profile</h1>
        <p className="text-sm text-muted">
          Your public page shows these details only while the profile is published.
        </p>
      </header>
      <ProfileForm profile={profile} categories={categories ?? []} />
    </main>
  );
}
