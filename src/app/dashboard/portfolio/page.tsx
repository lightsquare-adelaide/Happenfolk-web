import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FormAlert } from "@/components/form-alert";
import { loadManagedPortfolio } from "./load-managed-portfolio";
import { PortfolioManager } from "./portfolio-manager";

export const metadata = { title: `Portfolio — ${BRAND.name}` };

/**
 * The portfolio manager (S-P). Owner-scoped reads through the caller's
 * RLS client; every mutation goes through the validated API routes and
 * the accepted ordering RPC. /dashboard/media renders this SAME
 * component, so there is exactly one manager.
 */
export default async function DashboardPortfolioPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("category_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile == null || profile.category_id == null) redirect("/onboarding");

  const managed = await loadManagedPortfolio(supabase, user.id);

  return (
    <main className="shell-wrap py-10 lg:py-16">
      {managed.failed ? (
        <FormAlert tone="danger">
          Could not load your works. Please try again.
        </FormAlert>
      ) : (
        <PortfolioManager
          initial={managed.works}
          heading="Portfolio"
          intro="Create works, add images or a short H.264 video, describe each file, arrange the order and publish when a work is ready. Drafts stay private; only published works appear on your public artist page."
          handle={managed.handle}
          profilePublished={managed.profilePublished}
        />
      )}
    </main>
  );
}
