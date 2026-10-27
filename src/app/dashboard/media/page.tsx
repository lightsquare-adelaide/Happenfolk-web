import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FormAlert } from "@/components/form-alert";
import { loadManagedPortfolio } from "../portfolio/load-managed-portfolio";
import { PortfolioManager } from "../portfolio/portfolio-manager";

export const metadata = { title: `Media management — ${BRAND.name}` };

/**
 * Compatibility entry: /dashboard/media renders the SAME portfolio
 * manager as /dashboard/portfolio (one shared UI, no duplicate
 * conflicting manager), under its historical heading. Uploads,
 * captions, ordering and publication all live in that one component.
 */
export default async function MediaPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const managed = await loadManagedPortfolio(supabase, user.id);

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <Link prefetch={false} href="/dashboard" className="text-sm underline underline-offset-4">
        Back to your studio
      </Link>
      <div className="mt-7">
        {managed.failed ? (
          <FormAlert tone="danger">Could not load your media. Please try again.</FormAlert>
        ) : (
          <PortfolioManager
            initial={managed.works}
            heading="Media management"
            intro="Add media to your works, describe each file, arrange the order and publish when a work is ready."
            handle={managed.handle}
            profilePublished={managed.profilePublished}
          />
        )}
      </div>
    </main>
  );
}
