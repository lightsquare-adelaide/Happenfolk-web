import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { secondaryButtonClass } from "@/components/field";
import { BRAND } from "@/lib/brand";
import { formatEventDate, orderEvents, registrationStatusLabel } from "@/lib/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard — " + BRAND.name };
const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles")
    .select("handle, display_name, account_kind, category_id, published")
    .eq("id", user.id).maybeSingle();
  if (profile == null || profile.category_id == null) redirect("/onboarding");

  // Management queries belong to this caller; RLS remains the boundary.
  const [category, works, collaborations, registrations] = await Promise.all([
    supabase.from("categories").select("name").eq("id", profile.category_id).maybeSingle(),
    supabase.from("portfolio_items").select("id, title, published", { count: "exact" })
      .eq("profile_id", user.id).order("updated_at", { ascending: false }).limit(RECENT_LIMIT),
    supabase.from("event_collaborators").select("event_id").eq("profile_id", user.id),
    // Tingxuan: the user's own registration state, with RLS as a second guard.
    supabase.from("event_registrations")
      .select("id, event_id, status", { count: "exact" })
      .eq("member_id", user.id).order("created_at", { ascending: false }).limit(RECENT_LIMIT),
  ]);
  const eventIds = [...new Set((collaborations.data ?? []).map((row) => row.event_id))];
  const events = eventIds.length
    ? await supabase.from("events").select("id, title, status, starts_at").in("id", eventIds)
    : { data: [], error: null };
  const myEvents = orderEvents(events.data ?? [], new Date());
  const registeredEventIds = [...new Set((registrations.data ?? []).map((row) => row.event_id))];
  const registeredEvents = registeredEventIds.length
    ? await supabase.from("events").select("id, title").in("id", registeredEventIds)
    : { data: [], error: null };
  const registeredTitles = new Map((registeredEvents.data ?? []).map((row) => [row.id, row.title]));

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <header className="max-w-3xl">
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-[64px]">Your studio</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted">Manage your work, events and public profile.</p>
      </header>
      <section aria-label="Your profile" className="mt-8 flex min-w-0 flex-col gap-5 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-lg font-medium">{profile.display_name}</p>
          <p className="mt-1 break-words text-sm text-muted">{[
            "@" + profile.handle, category.data?.name,
            profile.published ? "Profile published" : "Profile hidden",
          ].filter(Boolean).join(" · ")}</p>
        </div>
        <nav aria-label="Profile management" className="flex shrink-0 flex-wrap items-center gap-3">
          <Link href="/dashboard/profile" className={secondaryButtonClass}>Edit profile</Link>
          <Link href={"/artists/" + profile.handle} className="px-1 py-2 text-sm underline underline-offset-4">
            {profile.published ? "View public page" : "Preview your page"}
          </Link>
        </nav>
      </section>
      <div className="mt-10 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-12">
        <StudioSection title="Portfolio" count={works.count} failed={works.error != null}
          empty="Make room for your first work."
          hint="Add images, a description or a short video. Keep work private until it is ready to share."
          action={{ href: "/dashboard/portfolio", label: "Manage portfolio" }}>
          {(works.data ?? []).map((work) => (
            <li key={work.id} className="flex min-w-0 items-start justify-between gap-4 py-4">
              <Link prefetch={false} href="/dashboard/portfolio" className="min-w-0 break-words font-medium underline-offset-4 hover:underline">{work.title}</Link>
              <span className="shrink-0 text-xs leading-6 text-muted">{work.published ? "Published" : "Draft"}</span>
            </li>
          ))}
        </StudioSection>
        <StudioSection title="Events" count={myEvents.length}
          failed={collaborations.error != null || events.error != null}
          empty="Bring people together."
          hint="Create an event or edit one with the artists listed as your collaborators."
          action={{ href: "/dashboard/events", label: "Manage events" }}>
          {myEvents.slice(0, RECENT_LIMIT).map((event) => (
            <li key={event.id} className="min-w-0 py-4">
              <Link prefetch={false} href="/dashboard/events" className="break-words font-medium underline-offset-4 hover:underline">{event.title}</Link>
              <p className="mt-1 text-sm text-muted">{formatEventDate(event.starts_at)} · {event.status === "published" ? "Published" : event.status === "draft" ? "Draft" : "Cancelled"}</p>
            </li>
          ))}
        </StudioSection>
        {/* Tingxuan: Registration management in the team studio */}
        <StudioSection title="Registrations" count={registrations.count}
          failed={registrations.error != null || registeredEvents.error != null}
          empty="Your next event is waiting."
          hint="Find a free event and save your place. Manage or cancel registrations here."
          action={{ href: "/dashboard/registrations", label: "My registrations" }}>
          {(registrations.data ?? []).map((registration) => (
            <li key={registration.id} className="min-w-0 py-4">
              <Link prefetch={false} href="/dashboard/registrations"
                className="break-words font-medium underline-offset-4 hover:underline">
                {registeredTitles.get(registration.event_id) ?? "Event unavailable"}
              </Link>
              <p className="mt-1 text-sm text-muted">{registrationStatusLabel(registration.status)}</p>
            </li>
          ))}
        </StudioSection>
        {/* W2: participation history entry point, link only — the page owns its queries. */}
        <section aria-label="History" className="min-w-0">
          <div className="flex min-h-52 min-w-0 flex-col items-start justify-center gap-4 border border-dashed border-line bg-surface p-6 sm:p-8">
            <span aria-hidden="true" className="block h-1 w-10 bg-brand" />
            <h2 className="font-display text-[32px] leading-tight">History</h2>
            <p className="max-w-md text-sm leading-7 text-muted">
              Everything you hosted, collaborated on or registered for — upcoming first, then the past.
            </p>
            <Link prefetch={false} href="/dashboard/history" className={secondaryButtonClass}>View history</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function StudioSection({ title, count, failed, empty, hint, action, children }: {
  title: string; count: number | null; failed: boolean; empty: string; hint: string;
  action: { href: string; label: string }; children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-[32px] leading-tight">{title}{!failed && count ? <span className="ml-3 font-sans text-sm text-muted">{count}</span> : null}</h2>
        {!failed && count ? <Link prefetch={false} href={action.href} className="text-sm underline underline-offset-4">{action.label}</Link> : null}
      </div>
      {failed ? (
        <div role="alert" className="border border-line bg-surface p-6">
          <p>Could not load your {title.toLowerCase()}.</p>
          <a href="/dashboard" className="mt-3 inline-block text-sm underline underline-offset-4">Reload dashboard</a>
        </div>
      ) : count ? <ul className="divide-y divide-line border-t border-line">{children}</ul>
        : <EmptyState title={empty} hint={hint} action={action} />}
    </section>
  );
}
