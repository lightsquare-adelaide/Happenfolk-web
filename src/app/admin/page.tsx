import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminTools } from "@/components/admin-tools";
import { BRAND } from "@/lib/brand";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Staff Moderation — ${BRAND.name}`,
};

/**
 * /admin — internal staff operations surface.
 *
 * Access is gated by `public.is_staff()` against `public.admin_staff`.
 * Non-staff members receive a 404 so the route does not advertise itself;
 * unauthenticated visitors are redirected to `/login?next=/admin`.
 */
export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");

  const { data: staff } = await supabase.rpc("is_staff");
  if (!staff) notFound();

  const admin = createSupabaseAdminClient();
  const [{ data: profiles }, { data: items }, { data: events }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, handle, display_name, bio, account_kind, published, is_hidden",
        )
        .order("handle", { ascending: true }),
      admin
        .from("portfolio_items")
        .select("id, profile_id, title, description, published, is_hidden")
        .order("created_at", { ascending: false }),
      admin
        .from("events")
        .select("id, title, description, location, status, is_hidden, starts_at")
        .order("starts_at", { ascending: true }),
    ]);

  return (
    <main className="shell-wrap space-y-12 py-12 lg:py-16">
      <header className="border-b border-line pb-8">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
          Internal Staff Operations · admin_staff
        </p>
        <h1 className="mt-3 font-display text-5xl leading-none tracking-tight md:text-[64px]">
          Moderation &amp; Data Corrections
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
          Toggling <code>is_hidden</code> removes a row from public SELECT
          policies, trending/recommended discovery views and search RPCs while
          keeping it visible to its owner in their studio.
        </p>
      </header>

      <section aria-labelledby="admin-profiles-heading" className="space-y-4">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <h2
            id="admin-profiles-heading"
            className="font-display text-2xl leading-tight"
          >
            Profiles
          </h2>
          <span className="font-mono text-xs text-muted">
            {(profiles ?? []).length} rows
          </span>
        </div>
        <div className="divide-y divide-line border border-line bg-surface">
          {(profiles ?? []).map((p) => (
            <div
              key={p.id}
              className="grid gap-4 p-4 md:grid-cols-12 md:items-center"
            >
              <div className="md:col-span-5">
                <Link
                  href={`/artists/${encodeURIComponent(p.handle)}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {p.display_name ?? p.handle}
                </Link>
                <p className="font-mono text-xs text-muted">
                  @{p.handle} · {p.account_kind} ·{" "}
                  {p.published ? "published" : "draft"}
                  {p.is_hidden ? " · HIDDEN" : ""}
                </p>
              </div>
              <div className="md:col-span-7">
                <AdminTools
                  subjectType="profile"
                  subjectId={p.id}
                  hidden={Boolean(p.is_hidden)}
                  fields={{
                    display_name: p.display_name ?? "",
                    bio: p.bio ?? "",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="admin-items-heading" className="space-y-4">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <h2
            id="admin-items-heading"
            className="font-display text-2xl leading-tight"
          >
            Portfolio items
          </h2>
          <span className="font-mono text-xs text-muted">
            {(items ?? []).length} rows
          </span>
        </div>
        <div className="divide-y divide-line border border-line bg-surface">
          {(items ?? []).map((item) => (
            <div
              key={item.id}
              className="grid gap-4 p-4 md:grid-cols-12 md:items-center"
            >
              <div className="md:col-span-5">
                <Link
                  href={`/items/${encodeURIComponent(item.id)}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
                <p className="font-mono text-xs text-muted">
                  {item.published ? "published" : "draft"}
                  {item.is_hidden ? " · HIDDEN" : ""}
                </p>
              </div>
              <div className="md:col-span-7">
                <AdminTools
                  subjectType="portfolio_item"
                  subjectId={item.id}
                  hidden={Boolean(item.is_hidden)}
                  fields={{
                    title: item.title ?? "",
                    description: item.description ?? "",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="admin-events-heading" className="space-y-4">
        <div className="flex items-baseline justify-between border-b border-line pb-3">
          <h2
            id="admin-events-heading"
            className="font-display text-2xl leading-tight"
          >
            Events
          </h2>
          <span className="font-mono text-xs text-muted">
            {(events ?? []).length} rows
          </span>
        </div>
        <div className="divide-y divide-line border border-line bg-surface">
          {(events ?? []).map((e) => (
            <div
              key={e.id}
              className="grid gap-4 p-4 md:grid-cols-12 md:items-center"
            >
              <div className="md:col-span-5">
                <Link
                  href={`/events/${encodeURIComponent(e.id)}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {e.title}
                </Link>
                <p className="font-mono text-xs text-muted">
                  {e.status}
                  {e.is_hidden ? " · HIDDEN" : ""} · {e.location ?? "TBA"}
                </p>
              </div>
              <div className="md:col-span-7">
                <AdminTools
                  subjectType="event"
                  subjectId={e.id}
                  hidden={Boolean(e.is_hidden)}
                  fields={{
                    title: e.title ?? "",
                    description: e.description ?? "",
                    location: e.location ?? "",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
