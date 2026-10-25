import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { formatEventDate, orderEvents, registrationStatusLabel } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: `Dashboard — ${BRAND.name}` };

const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();

  // HARD RULE: authorization via getUser() (server verified). The
  // middleware already gates this route; this is defense in depth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("handle, display_name, account_kind, category_id, published")
    .eq("id", user.id)
    .maybeSingle();

  if (profile == null || profile.category_id == null) {
    redirect("/onboarding");
  }

  // Every query is scoped to the caller explicitly; RLS also enforces it.
  const [category, works, collaborations, registrations] = await Promise.all([
    supabase.from("categories").select("name").eq("id", profile.category_id).maybeSingle(),
    supabase
      .from("portfolio_items")
      .select("id, title, published", { count: "exact" })
      .eq("profile_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase.from("event_collaborators").select("event_id").eq("profile_id", user.id),
    supabase
      .from("event_registrations")
      .select("id, event_id, status", { count: "exact" })
      .eq("member_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);

  // The shared client is untyped, so embedded joins come back typed as
  // arrays; event details are fetched in one follow-up query instead.
  const myEventIds = (collaborations.data ?? []).map((c) => c.event_id);
  const eventIds = [
    ...new Set([...myEventIds, ...(registrations.data ?? []).map((r) => r.event_id)]),
  ];
  const events = eventIds.length
    ? await supabase.from("events").select("id, title, status, starts_at").in("id", eventIds)
    : { data: [], error: null };
  const eventById = new Map((events.data ?? []).map((e) => [e.id, e]));
  const myEvents = orderEvents(
    myEventIds.map((id) => eventById.get(id)).filter((e) => e !== undefined),
    new Date(),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">
          Hi, {profile.display_name}
          <span className="ml-2 font-mono text-sm text-muted">@{profile.handle}</span>
        </h1>
        <p className="text-sm text-muted">
          {[
            category.data?.name,
            profile.account_kind === "organisation" ? "Organisation" : "Individual",
            profile.published ? "Profile published" : "Profile hidden",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <nav className="flex gap-4 text-sm">
          <Link href="/dashboard/profile" className="text-brand-700 underline">
            Edit profile
          </Link>
          <Link href={`/artists/${profile.handle}`} className="text-brand-700 underline">
            {profile.published ? "View public page" : "Preview public page"}
          </Link>
        </nav>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Section
          title="Works"
          count={works.count}
          failed={works.error != null}
          empty="You haven’t added any works yet."
        >
          {(works.data ?? []).map((w) => (
            <li key={w.id} className="flex justify-between gap-2">
              <span className="truncate">{w.title}</span>
              <span className="text-muted">{w.published ? "Published" : "Draft"}</span>
            </li>
          ))}
        </Section>

        <Section
          title="Events"
          count={myEvents.length}
          failed={collaborations.error != null || events.error != null}
          empty="You aren’t hosting or collaborating on any events yet."
        >
          {myEvents.slice(0, RECENT_LIMIT).map((e) => (
            <li key={e.id} className="flex flex-col">
              <span className="truncate">{e.title}</span>
              <span className="text-muted">
                {formatEventDate(e.starts_at)}
                {e.status === "draft" ? " · Draft" : e.status === "cancelled" ? " · Cancelled" : ""}
              </span>
            </li>
          ))}
        </Section>

        <Section
          title="Registrations"
          count={registrations.count}
          failed={registrations.error != null || events.error != null}
          empty="You haven’t registered for any events yet."
        >
          {(registrations.data ?? []).map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="truncate">{eventById.get(r.event_id)?.title ?? "Event"}</span>
              <span className="text-muted">{registrationStatusLabel(r.status)}</span>
            </li>
          ))}
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  count,
  failed,
  empty,
  children,
}: {
  title: string;
  count: number | null;
  failed: boolean;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium">
        {title}
        {!failed && count ? <span className="ml-2 text-sm text-muted">{count}</span> : null}
      </h2>
      {failed ? (
        <p role="alert" className="text-sm text-red-600">
          Couldn’t load {title.toLowerCase()}. Refresh to try again.
        </p>
      ) : count ? (
        <ul className="flex flex-col gap-2 text-sm">{children}</ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}
