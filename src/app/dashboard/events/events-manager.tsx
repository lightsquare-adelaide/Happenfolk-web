"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { FormAlert, type AlertTone } from "@/components/form-alert";
import {
  cardClass, dangerButtonClass, Field, inputClass, primaryButtonClass,
  secondaryButtonClass, selectClass, textareaClass,
} from "@/components/field";
import { formatEventDate } from "@/lib/dashboard";
import {
  adelaideWallTimeToInstant,
  instantToAdelaideWallClock,
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_TITLE_MAX,
} from "@/lib/events";

export type ManagedEvent = {
  id: string;
  title: string;
  location: string;
  description: string;
  categoryId: number | null;
  startsAt: string;
  endsAt: string;
  status: "draft" | "published" | "cancelled";
  coverPath: string | null;
  coverUrl: string | null;
  updatedAt: string;
  isHost: boolean;
  collaborators: { profileId: string; role: string; handle: string; displayName: string }[];
};

type Category = { id: number; name: string };
type Message = { tone: AlertTone; text: string } | null;

/**
 * Events manager, adapted from the personal version with the commerce
 * surface removed (S5 has no price, capacity or registration UI;
 * events keep the database default price of 0).
 *
 * Rules mirrored from the server, never replaced by it: ordinary
 * editing belongs to every roster member; roster changes and deletion
 * are host-only; at least one organiser always remains — the database
 * trigger is the authority and its 409 is surfaced verbatim in the
 * alert. The list renders server props (router.refresh re-fetches them
 * after every mutation) and each card REMOUNTS on data change via a
 * key that includes updated_at, so there is no stale useState(initial)
 * copy of a field the server already moved on from.
 *
 * Times: forms show Adelaide wall time (labelled). Conversion to a UTC
 * instant runs through the shared E2 helper — real zone rules, DST
 * gaps and repeats rejected with the helper's own message.
 */

function wallToInstant(
  date: string,
  time: string,
  label: string,
): { ok: true; iso: string } | { ok: false; problem: string } {
  if (!date || !time) return { ok: false, problem: `${label}: date and time both need a value` };
  const converted = adelaideWallTimeToInstant(date, time);
  return converted.ok
    ? { ok: true, iso: converted.iso }
    : { ok: false, problem: `${label}: ${converted.problem}` };
}

export function EventsManager({ initial, categories }: { initial: ManagedEvent[]; categories: Category[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [creating, setCreating] = useState(false);
  const createForm = useRef<HTMLFormElement>(null);

  async function call(
    url: string,
    init: RequestInit,
    okText?: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(url, init);
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setMessage({ tone: "danger", text: (data.error as string) ?? `Request failed (${response.status})` });
        if (response.status === 409) router.refresh(); // resync to the current version
        return null;
      }
      if (okText) setMessage({ tone: "success", text: okText });
      router.refresh();
      return data;
    } catch {
      setMessage({ tone: "danger", text: "Could not reach the server. Check your connection and try again." });
      return null;
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  async function createEvent(form: HTMLFormElement) {
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? "").trim();
    const start = wallToInstant(text("startDate"), text("startTime"), "Start");
    if (!start.ok) { setMessage({ tone: "danger", text: start.problem }); return; }
    let end: { ok: true; iso: string | null } | { ok: false; problem: string } = { ok: true, iso: null };
    if (text("endDate") || text("endTime")) {
      const converted = wallToInstant(text("endDate"), text("endTime"), "End");
      if (!converted.ok) { setMessage({ tone: "danger", text: converted.problem }); return; }
      end = { ok: true, iso: converted.iso };
    }
    setCreating(true);
    const data = await call("/api/events", json("POST", {
      title: text("title"),
      location: text("location"),
      description: text("description") || null,
      category_id: text("categoryId") ? Number(text("categoryId")) : null,
      starts_at: start.iso,
      ends_at: end.iso,
    }), "Draft created. It stays private until you publish.");
    setCreating(false);
    if (data) form.reset();
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      </div>

      <form
        ref={createForm}
        className={`flex min-w-0 flex-col gap-5 ${cardClass}`}
        aria-busy={creating}
        onSubmit={(event) => {
          event.preventDefault();
          void createEvent(event.currentTarget);
        }}
      >
        <h2 className="font-display text-[32px] leading-tight">New event</h2>
        <fieldset disabled={creating} className="contents">
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field label="Event name">
              <input name="title" required maxLength={EVENT_TITLE_MAX} className={inputClass} />
            </Field>
            <Field label="Location" hint="One line describing where it happens, for example a venue or street.">
              <input name="location" required maxLength={EVENT_LOCATION_MAX} className={inputClass} />
            </Field>
            <Field label="Starts — date (Adelaide)" hint="All times are Australia/Adelaide local time.">
              <input name="startDate" type="date" required className={inputClass} />
            </Field>
            <Field label="Starts — time (Adelaide)">
              <input name="startTime" type="time" required className={inputClass} />
            </Field>
            <Field label="Ends — date (optional, Adelaide)">
              <input name="endDate" type="date" className={inputClass} />
            </Field>
            <Field label="Ends — time (optional, Adelaide)">
              <input name="endTime" type="time" className={inputClass} />
            </Field>
            <Field label="Category (optional)" className="sm:col-span-2">
              <select name="categoryId" defaultValue="" className={selectClass}>
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <textarea name="description" maxLength={EVENT_DESCRIPTION_MAX} className={textareaClass} />
            </Field>
          </div>
          <div className="flex items-center gap-4">
            <button type="submit" disabled={creating} className={primaryButtonClass}>
              {creating ? "Creating…" : "Create draft"}
            </button>
            <span className="text-sm text-muted">New events start as drafts. Only your roster sees them.</span>
          </div>
        </fieldset>
      </form>

      {initial.length === 0 ? (
        <EmptyState
          title="No events yet"
          hint="Your drafts and published events appear here, including events other artists invite you to organise."
        />
      ) : (
        <ul className="flex min-w-0 flex-col gap-6">
          {initial.map((event) => (
            // Remount on every data change: fields and views always
            // come from a fresh server read, never a stale copy.
            <li key={`${event.id}:${event.updatedAt}`}>
              <EventCard event={event} categories={categories} call={call} json={json} setMessage={setMessage} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type CardProps = {
  event: ManagedEvent;
  categories: Category[];
  call: (url: string, init: RequestInit, okText?: string) => Promise<Record<string, unknown> | null>;
  json: (method: string, body: unknown) => RequestInit;
  setMessage: (message: Message) => void;
};

function EventCard({ event, categories, call, json, setMessage }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);

  const start = instantToAdelaideWallClock(event.startsAt);
  const end = event.endsAt ? instantToAdelaideWallClock(event.endsAt) : { date: "", time: "" };

  async function patch(body: Record<string, unknown>, okText?: string) {
    return call(`/api/events/${event.id}`, json("PATCH", body), okText);
  }

  async function saveEdit(form: HTMLFormElement) {
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? "").trim();
    const startConverted = wallToInstant(text("startDate"), text("startTime"), "Start");
    if (!startConverted.ok) { setMessage({ tone: "danger", text: startConverted.problem }); return; }
    let endsAt: string | null = null;
    if (text("endDate") || text("endTime")) {
      const endConverted = wallToInstant(text("endDate"), text("endTime"), "End");
      if (!endConverted.ok) { setMessage({ tone: "danger", text: endConverted.problem }); return; }
      endsAt = endConverted.iso;
    }
    setSaving(true);
    const done = await patch({
      title: text("title"),
      location: text("location"),
      description: text("description") || null,
      category_id: text("categoryId") ? Number(text("categoryId")) : null,
      starts_at: startConverted.iso,
      ends_at: endsAt,
    }, "Changes saved.");
    setSaving(false);
    if (done) setEditing(false);
  }

  async function removeCollaborator(profileId: string) {
    setRemoving(true);
    await call(`/api/events/${event.id}/collaborators`, json("DELETE", { profileId }));
    setRemoving(false);
  }

  async function addCollaborator(form: HTMLFormElement) {
    const handle = String(new FormData(form).get("handle") ?? "").trim();
    if (!handle) { setMessage({ tone: "danger", text: "Enter the artist's handle first." }); return; }
    setAdding(true);
    const done = await call(`/api/events/${event.id}/collaborators`, json("POST", { handle }), "Collaborator added. They can edit ordinary details now.");
    setAdding(false);
    if (done) form.reset();
  }

  return (
    <article className={`flex min-w-0 flex-col gap-5 ${cardClass}`}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="break-words font-display text-[32px] leading-tight">{event.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            {formatEventDate(event.startsAt)}
            {event.endsAt ? <> – {formatEventDate(event.endsAt)}</> : null}
            {" · Adelaide"}
            {event.location ? <> · {event.location}</> : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-muted">
            Status: <span className="font-medium text-foreground">{event.status}</span>
          </p>
          {event.isHost ? null : <p className="mt-1 text-sm text-muted">You are a collaborator</p>}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link prefetch={false} href={`/events/${event.id}`} className={secondaryButtonClass}>
          {event.status === "published" ? "View public page" : "Preview page"}
        </Link>
        {event.status === "draft" ? (
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => void patch({ status: "published" }, "Event published — it is visible on /events now.")}
          >
            Publish
          </button>
        ) : null}
        {event.status === "published" ? (
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => void patch({ status: "cancelled" }, "Event cancelled. It stays off the public index.")}
          >
            Cancel event
          </button>
        ) : null}
        <button type="button" className={secondaryButtonClass} onClick={() => setEditing(!editing)}>
          {editing ? "Close editor" : "Edit details"}
        </button>
        {event.isHost ? <DeleteEventButton event={event} call={call} /> : null}
      </div>

      {editing ? (
        <form
          className="grid min-w-0 gap-5 border-t border-line pt-5 sm:grid-cols-2"
          aria-busy={saving}
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            void saveEdit(formEvent.currentTarget);
          }}
        >
          <fieldset disabled={saving} className="contents">
            <Field label="Event name">
              <input name="title" required maxLength={EVENT_TITLE_MAX} defaultValue={event.title} className={inputClass} />
            </Field>
            <Field label="Location">
              <input name="location" required maxLength={EVENT_LOCATION_MAX} defaultValue={event.location} className={inputClass} />
            </Field>
            <Field label="Starts — date (Adelaide)">
              <input name="startDate" type="date" required defaultValue={start.date} className={inputClass} />
            </Field>
            <Field label="Starts — time (Adelaide)">
              <input name="startTime" type="time" required defaultValue={start.time} className={inputClass} />
            </Field>
            <Field label="Ends — date (optional, Adelaide)">
              <input name="endDate" type="date" defaultValue={end.date} className={inputClass} />
            </Field>
            <Field label="Ends — time (optional, Adelaide)">
              <input name="endTime" type="time" defaultValue={end.time} className={inputClass} />
            </Field>
            <Field label="Category (optional)" className="sm:col-span-2">
              <select name="categoryId" defaultValue={event.categoryId?.toString() ?? ""} className={selectClass}>
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <textarea name="description" maxLength={EVENT_DESCRIPTION_MAX} defaultValue={event.description} className={textareaClass} />
            </Field>
            <div className="sm:col-span-2">
              <button type="submit" disabled={saving} className={primaryButtonClass}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </fieldset>
        </form>
      ) : null}

      <CoverSection event={event} call={call} setMessage={setMessage} />

      <section className="min-w-0 border-t border-line pt-5" aria-labelledby={`roster-${event.id}`}>
        <h4 id={`roster-${event.id}`} className="text-xs uppercase tracking-wider text-muted">
          Organising artists ({event.isHost ? "only you can change this list" : "managed by the organiser"})
        </h4>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {event.collaborators.map((member) => (
            <li key={member.profileId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border border-line px-4 py-2">
              <span className="min-w-0 break-words">
                {member.handle ? (
                  <Link prefetch={false} href={`/artists/${member.handle}`} className="underline underline-offset-4">{member.displayName}</Link>
                ) : member.displayName}
                {member.handle ? <span className="text-muted"> @{member.handle}</span> : null}
                <span className="ml-3 text-xs uppercase tracking-wider text-muted">{member.role}</span>
              </span>
              {event.isHost ? (
                <button
                  type="button"
                  disabled={removing}
                  className="min-h-11 border border-line-strong bg-background px-3 text-sm hover:bg-surface disabled:opacity-50"
                  onClick={() => void removeCollaborator(member.profileId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {event.isHost ? (
          <form
            className="mt-4 flex min-w-0 flex-wrap items-end gap-3"
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              void addCollaborator(formEvent.currentTarget);
            }}
          >
            <Field label="Add a collaborator by handle" className="min-w-0 flex-1">
              <input name="handle" required maxLength={30} autoComplete="off" spellCheck={false}
                aria-describedby={`roster-help-${event.id}`} className={inputClass + " font-mono"} />
            </Field>
            <button type="submit" disabled={adding} className={secondaryButtonClass}>
              {adding ? "Adding…" : "Add"}
            </button>
            <p id={`roster-help-${event.id}`} className="w-full text-sm leading-6 text-muted">
              Collaborators can edit ordinary details and the cover. They cannot manage this list or delete the event.
            </p>
          </form>
        ) : null}
      </section>
    </article>
  );
}

function DeleteEventButton({ event, call }: { event: ManagedEvent; call: CardProps["call"] }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className={dangerButtonClass} disabled={busy} onClick={() => setConfirming(true)}>
        Delete event
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={dangerButtonClass}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await call(`/api/events/${event.id}`, { method: "DELETE" }, "Event deleted.");
          setBusy(false);
          setConfirming(false);
        }}
      >
        {busy ? "Deleting…" : "Yes, delete it"}
      </button>
      <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setConfirming(false)}>
        Keep the event
      </button>
    </span>
  );
}

/**
 * Cover control with the public-bucket disclosure BEFORE any upload.
 * The covers bucket is public in the 0007 storage policies — the image
 * is world-readable from the moment it uploads even while the event is
 * a draft — so choosing a file only PREVIEW the disclosure; nothing
 * leaves the browser until "Upload cover" is confirmed.
 */
function CoverSection({
  event, call, setMessage,
}: {
  event: ManagedEvent;
  call: CardProps["call"];
  setMessage: (message: Message) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!pending) return;
    const body = new FormData();
    body.append("file", pending);
    setBusy(true);
    const done = await call(`/api/events/${event.id}/cover`, { method: "POST", body }, "Cover uploaded.");
    setBusy(false);
    if (done) setPending(null);
  }

  return (
    <section className="min-w-0 border-t border-line pt-5" aria-label={`Cover for ${event.title}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {event.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverUrl} alt={`Cover of ${event.title}`} width={160} height={100}
            className="h-25 w-40 border border-line object-cover" />
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          aria-label={`Choose cover image for ${event.title}`}
          className="sr-only"
          onChange={(changeEvent) => {
            const file = changeEvent.target.files?.[0] ?? null;
            setPending(file);
            if (file) {
              setMessage({
                tone: "warning",
                text: "Covers are stored in a public bucket: anyone with the link can open this image, even while the event is still a draft. Review the picture, then confirm the upload below.",
              });
            }
            changeEvent.target.value = "";
          }}
        />
        <button type="button" className={secondaryButtonClass} onClick={() => inputRef.current?.click()}>
          {event.coverPath ? "Change cover" : "Choose cover image"}
        </button>
        {event.coverPath ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() => void call(`/api/events/${event.id}/cover`, { method: "DELETE" }, "Cover removed.")}
          >
            Remove cover
          </button>
        ) : null}
      </div>
      {pending ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border border-line bg-surface px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 break-words">
            Ready to upload <strong>{pending.name}</strong>. It will be public to anyone holding the link.
          </span>
          <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => void upload()}>
            {busy ? "Uploading…" : "Upload cover"}
          </button>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-muted">
        JPEG, PNG or WebP up to 4 MB. Location data and camera metadata are stripped before the image is stored.
      </p>
    </section>
  );
}
