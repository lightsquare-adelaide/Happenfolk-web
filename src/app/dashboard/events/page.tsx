import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EventsManager, type ManagedEvent } from "./events-manager";

export const metadata = { title: `Events — ${BRAND.name}` };

/**
 * Dashboard events manager (S5). RLS also publishes other people's
 * events, so the page filters to MY involvement: events I host plus
 * events I am listed on as a collaborator. Everything below reads
 * through the same policies the API enforces — no service-role view.
 */
type RosterRow = { event_id: string; profile_id: string; role: string };

export default async function DashboardEventsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: collaboratedRows, error: rosterError } = await supabase
    .from("event_collaborators")
    .select("event_id")
    .eq("profile_id", user.id);
  if (rosterError) throw new Error("Could not load your collaborations");
  const collaboratedIds = new Set((collaboratedRows ?? []).map((row) => row.event_id));

  let eventsQuery = supabase
    .from("events")
    .select("id, title, location, description, category_id, starts_at, ends_at, status, cover_path, host_id, updated_at")
    .order("starts_at");
  // Filter at the database boundary, before the API row limit: a large
  // public directory must not push the caller's own events out of view.
  eventsQuery = collaboratedIds.size
    ? eventsQuery.or(`host_id.eq.${user.id},id.in.(${[...collaboratedIds].join(",")})`)
    : eventsQuery.eq("host_id", user.id);
  const { data: eventRows, error: eventsError } = await eventsQuery;
  if (eventsError) throw new Error("Could not load events");
  const mine = (eventRows ?? []).filter(
    (event) => event.host_id === user.id || collaboratedIds.has(event.id),
  );
  const eventIds = mine.map((event) => event.id);

  const rosterResult: { data: RosterRow[] | null; error: unknown } = eventIds.length > 0
    ? await supabase.from("event_collaborators").select("event_id, profile_id, role").in("event_id", eventIds)
    : { data: [], error: null };
  const categoriesResult = await supabase.from("categories").select("id, name").order("sort_order");
  if (rosterResult.error) throw new Error("Could not load event rosters");

  const profileIds = [...new Set((rosterResult.data ?? []).map((row) => row.profile_id))];
  const profileResult: { data: { id: string; handle: string; display_name: string }[] | null } = profileIds.length > 0
    ? await supabase.from("profiles").select("id, handle, display_name").in("id", profileIds)
    : { data: [] as { id: string; handle: string; display_name: string }[] };
  // RLS shows published profiles only; unpublished teammates surface
  // with a plain fallback instead of a broken link.
  const profileById = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));

  const managed: ManagedEvent[] = mine.map((event) => ({
    id: event.id,
    title: event.title,
    location: event.location ?? "",
    description: event.description ?? "",
    categoryId: event.category_id ?? null,
    startsAt: event.starts_at,
    endsAt: event.ends_at ?? "",
    status: event.status,
    coverPath: event.cover_path,
    coverUrl: event.cover_path
      ? supabase.storage.from("covers").getPublicUrl(event.cover_path).data.publicUrl
      : null,
    updatedAt: event.updated_at,
    isHost: event.host_id === user.id,
    collaborators: (rosterResult.data ?? [])
      .filter((row) => row.event_id === event.id)
      .map((row) => {
        const profile = profileById.get(row.profile_id);
        return {
          profileId: row.profile_id,
          role: row.role,
          handle: profile?.handle ?? "",
          displayName: profile?.display_name ?? "Artist (profile not published)",
        };
      }),
  }));

  return (
    <main className="shell-wrap py-10 lg:py-16">
      <Link href="/dashboard" className="text-sm underline underline-offset-4">Back to your studio</Link>
      <header className="mt-7 max-w-2xl">
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-[64px]">Events</h1>
        <p className="mt-4 text-base leading-7 text-muted">
          Drafts and published events you host or collaborate on. Everyone on the roster can edit
          ordinary details; only the organiser manages the roster or deletes the event.
        </p>
      </header>
      <div className="mt-10">
        <EventsManager
          initial={managed}
          categories={(categoriesResult.data ?? []).map((category) => ({ id: category.id, name: category.name }))}
        />
      </div>
    </main>
  );
}
