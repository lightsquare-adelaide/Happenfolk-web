import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BRAND } from "@/lib/brand";
import { AvatarUpload } from "@/components/avatar-upload";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Edit profile — " + BRAND.name };

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: categories }] = await Promise.all([
    supabase.from("profiles").select("handle, display_name, account_kind, category_id, bio, published, avatar_path").eq("id", user.id).maybeSingle(),
    supabase.from("categories").select("id, name").order("sort_order"),
  ]);
  if (profile == null || profile.category_id == null) redirect("/onboarding");
  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl : null;

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <Link href="/dashboard" className="text-sm underline underline-offset-4">Back to your studio</Link>
      <header className="mt-7 max-w-2xl">
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-[64px]">Edit profile</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted">Introduce your practice. You decide when your profile is ready to be public.</p>
      </header>
      <div className="mt-10 grid min-w-0 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-20">
        <ProfileForm profile={profile} categories={categories ?? []} />
        <aside className="min-w-0 border-t border-line pt-6 lg:sticky lg:top-24">
          <AvatarUpload currentUrl={avatarUrl} />
          <section className="mt-8 border-t border-line pt-6" aria-labelledby="profile-visibility">
            <h2 id="profile-visibility" className="font-sans font-medium">Your public page</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{profile.published ? "Your profile is visible to visitors." : "Your profile is hidden. You can preview it while signed in."} Portfolio works have their own publication controls.</p>
            <Link href={"/artists/" + profile.handle} className="mt-3 inline-block break-all text-sm underline underline-offset-4">{profile.published ? "View" : "Preview"} @{profile.handle}</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
