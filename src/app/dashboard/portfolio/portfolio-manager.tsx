"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { FormAlert, type AlertTone } from "@/components/form-alert";
import {
  cardClass, dangerButtonClass, Field, inputClass, primaryButtonClass,
  secondaryButtonClass, textareaClass,
} from "@/components/field";
import {
  DESCRIPTION_MAX, parseItemCreate, parseItemPatch, TAGS_MAX, TAG_MAX,
  TITLE_MAX, YEAR_MAX, YEAR_MIN,
} from "@/lib/portfolio-management";
import type { ManagedAsset, ManagedWork } from "./load-managed-portfolio";

type Message = { tone: AlertTone; text: string; focusAssetId?: string } | null;

type UploadState = {
  key: string;
  itemId: string;
  name: string;
  file: File;
  progress: number;
  status: "uploading" | "processing" | "done" | "failed";
  message?: string;
};

/** UX pre-filter only — the server sniffs bytes and decides validity. */
const ACCEPTED = ".jpg,.jpeg,.png,.webp,.mp4";
const MAX_BYTES = 4 * 1024 * 1024;
function looksAccepted(name: string): boolean {
  return /\.(jpe?g|png|webp|mp4)$/i.test(name);
}

function splitTags(raw: string): string[] {
  return raw.split(",").map((tag) => tag.trim()).filter(Boolean);
}

/**
 * Portfolio manager: metadata CRUD, per-item drag/drop uploads with real
 * progress and explicit retry, per-asset captions, item and media
 * ordering, publish/unpublish and whole-work deletion.
 *
 * Refresh correctness: the list renders the SERVER props directly (no
 * useState(initial) copy), HTTP responses resync server state, and
 * each card REMOUNTS on a key that includes the media stamp — uploads,
 * caption edits and media reorders do not necessarily bump the item's
 * updated_at, so the stamp carries media id/position/alt. Signed URL
 * token churn alone does not change the stamp and never resets edits.
 *
 * Publication never sends a global altText: captions live on each asset
 * and the server refuses to publish while any original lacks one.
 */
export function PortfolioManager({
  initial, heading, intro, handle, profilePublished,
}: {
  initial: ManagedWork[];
  heading: string;
  intro: string;
  handle: string | null;
  profilePublished: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<Message>(null);
  const [creating, setCreating] = useState(false);
  // Per-item pending set (functional updates): operating on a second
  // work must never clear or overwrite the first one's busy state.
  const [busyItems, setBusyItems] = useState<ReadonlySet<string>>(new Set());
  const [uploads, setUploads] = useState<UploadState[]>([]);

  async function call(url: string, init: RequestInit, okText?: string): Promise<Record<string, unknown> | null> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      // Transport-level failure (offline / connection lost). Deliberately
      // NO router.refresh() here: while disconnected the RSC payload
      // fetch also fails and Next falls back to a full browser
      // navigation into chrome-error://, destroying the page and every
      // typed input. The friendly alert plus preserved fields are the
      // correct offline state; the retry after reconnecting refreshes.
      setMessage({ tone: "danger", text: "Could not reach the server. Check your connection and try again." });
      return null;
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      setMessage({ tone: "danger", text: (data.error as string) ?? `Request failed (${response.status})` });
      // A real HTTP response may reflect changed server state even on
      // failure (a 409 lease, or a 500 from a partially completed
      // delete), so resync.
      router.refresh();
      return null;
    }
    if (okText) setMessage({ tone: "success", text: okText });
    router.refresh();
    return data;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  /** Wraps a per-item mutation: pending state + guaranteed release. */
  async function run(item: ManagedWork, action: () => Promise<void>) {
    setBusyItems((prev) => new Set(prev).add(item.id));
    try {
      await action();
    } finally {
      setBusyItems((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function createWork(form: HTMLFormElement) {
    const values = new FormData(form);
    const body = {
      title: String(values.get("title") ?? ""),
      description: String(values.get("description") ?? "") || null,
      year: String(values.get("year") ?? "") === "" ? null : Number(values.get("year")),
      tags: splitTags(String(values.get("tags") ?? "")),
    };
    const parsed = parseItemCreate(body);
    if (!parsed.ok) {
      setMessage({ tone: "danger", text: parsed.problem });
      return;
    }
    setCreating(true);
    try {
      const data = await call("/api/portfolio/items", json("POST", body), "Draft created. Add media below — it stays private until you publish.");
      // Reset ONLY after confirmed success: a validation or network
      // failure must preserve every field for correction and retry.
      if (data) form.reset();
    } finally {
      setCreating(false);
    }
  }

  async function saveMetadata(item: ManagedWork, form: HTMLFormElement) {
    const values = new FormData(form);
    const body = {
      title: String(values.get("title") ?? ""),
      description: String(values.get("description") ?? "") || null,
      year: String(values.get("year") ?? "") === "" ? null : Number(values.get("year")),
      tags: splitTags(String(values.get("tags") ?? "")),
    };
    const parsed = parseItemPatch(body);
    if (!parsed.ok) {
      setMessage({ tone: "danger", text: parsed.problem });
      return false;
    }
    const done = await call(`/api/portfolio/items/${item.id}`, json("PATCH", body), "Changes saved.");
    return done !== null;
  }

  async function moveItem(item: ManagedWork, direction: "up" | "down") {
    const data = await call("/api/portfolio/reorder", json("POST", { itemId: item.id, direction }));
    if (data && data.moved === false) {
      setMessage({ tone: "info", text: direction === "up" ? "Already at the top of your list." : "Already at the bottom of your list." });
    }
  }

  async function togglePublish(item: ManagedWork) {
    if (item.published) {
      await call("/api/media/unpublish", json("POST", { itemId: item.id }), "Unpublished. The public copies are removed; your private masters stay.");
      return;
    }
    // NEVER send a global altText: per-asset captions are the contract.
    let response: Response;
    try {
      response = await fetch("/api/media/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
    } catch {
      // Transport failure: friendly alert, no refresh (see call()).
      setMessage({ tone: "danger", text: "Could not reach the server. Check your connection and try again." });
      return;
    }
    try {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const missing = item.assets.find((asset) => asset.altText.trim().length === 0);
        setMessage({
          tone: "danger",
          text: data.error ?? `Request failed (${response.status})`,
          focusAssetId: missing?.id,
        });
        return;
      }
      setMessage({ tone: "success", text: "Published. Your work is visible on your public artist page." });
    } finally {
      router.refresh();
    }
  }

  async function deleteWork(item: ManagedWork) {
    await call(`/api/portfolio/items/${item.id}`, { method: "DELETE" }, "Work deleted, including its stored files.");
  }

  async function saveCaption(item: ManagedWork, asset: ManagedAsset, value: string) {
    await call("/api/portfolio/media", json("PATCH", { itemId: item.id, assetId: asset.id, alt: value }), "Caption saved.");
  }

  async function moveAsset(item: ManagedWork, asset: ManagedAsset, direction: "up" | "down") {
    await call("/api/media/reorder", json("POST", { itemId: item.id, assetId: asset.id, direction }));
  }

  // ---------------- uploads (serialized per item, one file per request) ----------------

  /** Resolves true when the server actually answered (HTTP response). */
  function uploadFile(entry: UploadState): Promise<boolean> {
    return new Promise((resolve) => {
      const patch = (changes: Partial<UploadState>) =>
        setUploads((prev) => prev.map((u) => (u.key === entry.key ? { ...u, ...changes } : u)));
      // Every terminal path resolves exactly once so the queue can never stick.
      let settled = false;
      const finish = (changes: Partial<UploadState>, responded: boolean) => {
        if (settled) return;
        settled = true;
        patch(changes);
        resolve(responded);
      };
      patch({ status: "uploading", progress: 0, message: undefined });
      const form = new FormData();
      form.append("file", entry.file);
      form.append("itemId", entry.itemId);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/media/upload");
      xhr.timeout = 60_000; // finite: a hung connection must not wedge the queue
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || settled) return;
        const progress = Math.round((event.loaded / event.total) * 100);
        // Bytes sent is not the same as server processing: sniffing,
        // derivatives and the DB row happen after the last byte.
        patch(progress >= 100 ? { progress, status: "processing" } : { progress });
      };
      xhr.onload = () => {
        if (xhr.status === 201) {
          finish({ progress: 100, status: "done" }, true);
          return;
        }
        let serverMessage: string | undefined;
        try {
          serverMessage = (JSON.parse(xhr.responseText) as { error?: string }).error;
        } catch { /* non-JSON failure body */ }
        finish({ status: "failed", message: serverMessage ?? `Upload failed (${xhr.status})` }, true);
      };
      xhr.onerror = () => {
        // The response was lost: the server may or may not have stored
        // the file, so do not claim it was not uploaded.
        finish({ status: "failed", message: "Upload could not be confirmed; check this work before retrying." }, false);
      };
      xhr.ontimeout = () => {
        finish({ status: "failed", message: "Upload timed out; check your connection, then check this work before retrying." }, false);
      };
      xhr.onabort = () => {
        finish({ status: "failed", message: "Upload aborted; check this work before retrying." }, false);
      };
      xhr.send(form);
    });
  }

  async function enqueue(item: ManagedWork, files: File[]) {
    const entries: UploadState[] = files.map((file) => ({
      key: crypto.randomUUID(),
      itemId: item.id,
      name: file.name,
      file,
      progress: 0,
      status: "uploading" as const,
    }));
    // Client-side pre-filter for instant feedback; the server still sniffs.
    for (const entry of entries) {
      if (!looksAccepted(entry.name) || entry.file.size > MAX_BYTES) {
        setUploads((prev) => [...prev, {
          ...entry, status: "failed",
          message: "Choose JPG, PNG, WebP or MP4 (H.264) up to 4 MiB",
        }]);
      } else {
        setUploads((prev) => [...prev, entry]);
      }
    }
    // Serialize: the media lease is per work, and the API takes one file
    // per request. One failure must not abort the rest of the queue.
    let anyResponse = false;
    for (const entry of entries) {
      if (looksAccepted(entry.name) && entry.file.size <= MAX_BYTES) {
        const responded = await uploadFile(entry);
        anyResponse = anyResponse || responded;
      }
    }
    // Refresh only when the server actually answered something: while
    // fully offline an RSC refresh would fall back to a browser
    // navigation into chrome-error:// and destroy the page state.
    if (anyResponse) router.refresh();
  }

  async function retry(entry: UploadState) {
    const responded = await uploadFile(entry);
    if (responded) router.refresh();
  }

  const itemUploads = (itemId: string) => uploads.filter((u) => u.itemId === itemId);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className="max-w-2xl">
        <h1 className="font-display text-5xl leading-none tracking-tight md:text-[64px]">{heading}</h1>
        <p className="mt-4 text-base leading-7 text-muted">{intro}</p>
        {handle ? (
          <p className="mt-2 text-sm">
            <Link prefetch={false} href={`/artists/${handle}`} className="underline underline-offset-4">
              {profilePublished ? "View your public artist page" : "Preview your public artist page"}
            </Link>
          </p>
        ) : null}
      </header>

      {/* Two separate switches: the profile and each work are published
          independently (profiles.published vs portfolio_items.published).
          Members who publish a work while the profile is private see a
          public-looking success message but an unreachable artist page —
          the pilot's top confusion. This persistent notice states the
          real visibility rule and links to the fix. The switches
          themselves are NOT merged and database rules are unchanged. */}
      {handle && !profilePublished ? (
        <FormAlert tone="warning">
          Your profile is private, so published works are not visible yet. {" "}
          <Link prefetch={false} href="/dashboard/profile" className="underline underline-offset-4">
            Publish your profile
          </Link>{" "}
          to make your artist page reachable.
        </FormAlert>
      ) : null}

      <div aria-live="polite" className="flex flex-col gap-2">
        {message ? (
          <FormAlert tone={message.tone}>
            {message.text}
            {message.focusAssetId ? (
              <>
                {" "}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => document.getElementById(`alt-${message.focusAssetId}`)?.focus()}
                >
                  Jump to the missing description
                </button>
              </>
            ) : null}
            {" "}
            <button type="button" className="underline underline-offset-4" onClick={() => setMessage(null)}>
              Dismiss
            </button>
          </FormAlert>
        ) : null}
      </div>

      <form
        className={`flex min-w-0 flex-col gap-5 ${cardClass}`}
        aria-busy={creating}
        onSubmit={(event) => {
          event.preventDefault();
          void createWork(event.currentTarget);
        }}
      >
        <h2 className="font-display text-[32px] leading-tight">New work</h2>
        <fieldset disabled={creating} className="contents">
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field label="Title" hint={`Up to ${TITLE_MAX} characters.`}>
              <input name="title" required maxLength={TITLE_MAX} className={inputClass} />
            </Field>
            <Field label="Year (optional)" hint={`${YEAR_MIN}–${YEAR_MAX}.`}>
              <input name="year" type="number" min={YEAR_MIN} max={YEAR_MAX} className={inputClass} />
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2" hint={`Up to ${DESCRIPTION_MAX} characters.`}>
              <textarea name="description" maxLength={DESCRIPTION_MAX} className={textareaClass} />
            </Field>
            <Field label="Tags (optional, comma-separated)" className="sm:col-span-2" hint={`Up to ${TAGS_MAX} tags of ${TAG_MAX} characters; lowercased and deduplicated.`}>
              <input name="tags" className={inputClass} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={creating} className={primaryButtonClass}>
              {creating ? "Creating…" : "Create draft"}
            </button>
            <span className="text-sm text-muted">Drafts are private. Publish when a work is ready to share.</span>
          </div>
        </fieldset>
      </form>

      {initial.length === 0 ? (
        <EmptyState
          title="No works yet"
          hint="Create your first draft above, then add images or a short H.264 video. Everything stays private until you publish it."
        />
      ) : (
        <ul className="flex min-w-0 flex-col gap-6">
          {initial.map((work, index) => (
            <li key={`${work.id}:${work.stamp}`}>
              <WorkCard
                work={work}
                index={index}
                total={initial.length}
                busy={busyItems.has(work.id)}
                uploads={itemUploads(work.id)}
                call={call}
                json={json}
                run={run}
                setMessage={setMessage}
                onSaveMetadata={saveMetadata}
                onMoveItem={moveItem}
                onTogglePublish={togglePublish}
                onDelete={deleteWork}
                onSaveCaption={saveCaption}
                onMoveAsset={moveAsset}
                onEnqueue={enqueue}
                onRetry={retry}
                handle={handle}
                profilePublished={profilePublished}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type CardProps = {
  work: ManagedWork;
  index: number;
  total: number;
  busy: boolean;
  uploads: UploadState[];
  call: (url: string, init: RequestInit, okText?: string) => Promise<Record<string, unknown> | null>;
  json: (method: string, body: unknown) => RequestInit;
  run: (work: ManagedWork, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: Message) => void;
  onSaveMetadata: (work: ManagedWork, form: HTMLFormElement) => Promise<boolean>;
  onMoveItem: (work: ManagedWork, direction: "up" | "down") => Promise<void>;
  onTogglePublish: (work: ManagedWork) => Promise<void>;
  onDelete: (work: ManagedWork) => Promise<void>;
  onSaveCaption: (work: ManagedWork, asset: ManagedAsset, value: string) => Promise<void>;
  onMoveAsset: (work: ManagedWork, asset: ManagedAsset, direction: "up" | "down") => Promise<void>;
  onEnqueue: (work: ManagedWork, files: File[]) => Promise<void>;
  onRetry: (entry: UploadState) => Promise<void>;
  handle: string | null;
  profilePublished: boolean;
};

function WorkCard(props: CardProps) {
  const { work, index, total, busy, uploads, run } = props;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const missingAlt = work.assets.filter((asset) => asset.altText.trim().length === 0);
  const metadataLine = [
    work.year ? String(work.year) : null,
    work.description.trim() || null,
    work.tags.length > 0 ? `#${work.tags.join(" #")}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className={`flex min-w-0 flex-col gap-5 ${cardClass}`} aria-label={`Work: ${work.title}`}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h3 className="break-words font-display text-[32px] leading-tight">{work.title}</h3>
          <p className="mt-2 break-words text-sm leading-6 text-muted">
            {metadataLine || "No description yet — edit details to add year, description and tags."}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-muted">
            Status: <span className="font-medium text-foreground">{work.published ? "Published" : "Draft"}</span>
          </p>
          {props.handle ? (
            work.published && props.profilePublished ? (
              <Link prefetch={false} href={`/artists/${props.handle}`} className="mt-1 inline-block text-sm underline underline-offset-4">
                View public page
              </Link>
            ) : props.profilePublished ? (
              <Link prefetch={false} href={`/artists/${props.handle}`} className="mt-1 inline-block text-sm underline underline-offset-4">
                Preview public page
              </Link>
            ) : (
              <Link prefetch={false} href="/dashboard/profile" className="mt-1 inline-block text-sm underline underline-offset-4">
                Publish your profile first
              </Link>
            )
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setEditing(!editing)}>
          {editing ? "Close editor" : "Edit details"}
        </button>
        {work.published ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() => void run(work, () => props.onTogglePublish(work))}
          >
            {busy ? "Working…" : "Unpublish"}
          </button>
        ) : (
          <button
            type="button"
            className={primaryButtonClass}
            disabled={busy || work.assets.length === 0}
            onClick={() => void run(work, () => props.onTogglePublish(work))}
          >
            {busy ? "Working…" : "Publish"}
          </button>
        )}
        {!work.published && work.assets.length === 0 ? (
          <span className="text-sm text-muted">Add media before publishing.</span>
        ) : null}
        {!work.published && !props.profilePublished ? (
          <span className="text-sm text-muted">
            Your profile is private — publishing this work will not make it visible until you publish your profile.
          </span>
        ) : null}
        {!work.published && missingAlt.length > 0 ? (
          <span className="text-sm text-danger">
            {missingAlt.length} media {missingAlt.length === 1 ? "is" : "are"} missing a description — publishing needs one on every file.
          </span>
        ) : null}
      </div>

      {editing ? (
        <form
          className="grid min-w-0 gap-5 border-t border-line pt-5 sm:grid-cols-2"
          aria-busy={saving}
          onSubmit={(event) => {
            event.preventDefault();
            void (async () => {
              setSaving(true);
              const done = await props.onSaveMetadata(work, event.currentTarget);
              setSaving(false);
              // On failure the editor stays open and every typed value is
              // preserved (uncontrolled inputs) for correction and retry.
              if (done) setEditing(false);
            })();
          }}
        >
          <fieldset disabled={saving} className="contents">
            <Field label="Title">
              <input name="title" required maxLength={TITLE_MAX} defaultValue={work.title} className={inputClass} />
            </Field>
            <Field label="Year (optional)">
              <input name="year" type="number" min={YEAR_MIN} max={YEAR_MAX} defaultValue={work.year ?? ""} className={inputClass} />
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <textarea name="description" maxLength={DESCRIPTION_MAX} defaultValue={work.description} className={textareaClass} />
            </Field>
            <Field label="Tags (comma-separated)" className="sm:col-span-2">
              <input name="tags" defaultValue={work.tags.join(", ")} className={inputClass} />
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button type="submit" disabled={saving} className={primaryButtonClass}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button type="button" disabled={saving} className={secondaryButtonClass} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      ) : null}

      <section className="flex min-w-0 flex-col gap-3 border-t border-line pt-5" aria-label={`Media management for ${work.title}`}>
        <h4 className="text-xs uppercase tracking-wider text-muted">
          Media ({work.assets.length}) — your originals stay private
        </h4>

        {work.assets.length === 0 ? (
          <p className="text-sm text-muted">No media yet. Upload images or an H.264 MP4 below.</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-4">
            {work.assets.map((asset, assetIndex) => (
              // Per-asset remount key: a caption save remounts ONLY the
              // edited row onto its fresh server value; sibling rows keep
              // their in-progress inputs. Position changes (reorder) and
              // new uploads land here too.
              <AssetRow
                key={`${asset.id}:${asset.position}:${asset.altText}`}
                work={work}
                asset={asset}
                assetIndex={assetIndex}
                assetCount={work.assets.length}
                busy={busy}
                onSaveCaption={props.onSaveCaption}
                onMoveAsset={props.onMoveAsset}
                run={run}
              />
            ))}
          </ul>
        )}

        {work.published ? (
          <p className="text-sm text-muted">
            Unpublish this work to add, reorder or re-caption media — public copies must never go stale.
          </p>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Upload media for ${work.title}: drag and drop or press Enter to choose files`}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(event) => {
              if ((event.key === "Enter" || event.key === " ") && !busy) inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (busy) return;
              const files = [...event.dataTransfer.files];
              if (files.length > 0) void run(work, () => props.onEnqueue(work, files));
            }}
            className={`flex cursor-pointer flex-col items-center gap-1 border border-dashed p-6 text-center transition-colors motion-reduce:transition-none sm:p-8 ${
              dragging ? "border-foreground bg-tint" : "border-line bg-background"
            } ${busy ? "opacity-50" : ""}`}
          >
            <span className="font-medium">Drag files here, or press Enter to choose</span>
            <span className="text-sm text-muted">
              JPG / PNG / WebP / MP4 (H.264), up to 4 MiB each. Files upload one at a time.
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              aria-label={`Choose media files for ${work.title}`}
              className="hidden"
              onChange={(event) => {
                const files = event.target.files ? [...event.target.files] : [];
                event.target.value = "";
                if (files.length > 0 && !busy) void run(work, () => props.onEnqueue(work, files));
              }}
            />
          </div>
        )}

        {uploads.length > 0 ? (
          <ul className="flex min-w-0 flex-col gap-2 text-sm" aria-live="polite" aria-label={`Upload progress for ${work.title}`}>
            {uploads.map((entry) => (
              <li key={entry.key} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border border-line bg-background px-3 py-2">
                <span className="min-w-0 flex-1 break-all">{entry.name}</span>
                {entry.status === "uploading" ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      role="progressbar"
                      aria-valuenow={entry.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Uploading ${entry.name}`}
                      className="block h-2 w-24 border border-line bg-surface"
                    >
                      <span
                        className="block h-full bg-brand transition-[width] duration-200 motion-reduce:transition-none"
                        style={{ width: `${entry.progress}%` }}
                      />
                    </span>
                    <span className="text-muted">{entry.progress}% sent</span>
                  </span>
                ) : null}
                {entry.status === "processing" ? <span className="text-muted">Processing on the server…</span> : null}
                {entry.status === "done" ? <span className="text-success">Uploaded</span> : null}
                {entry.status === "failed" ? (
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 break-words text-danger">{entry.message ?? "Failed"}</span>
                    <button
                      type="button"
                      className="min-h-11 border border-line-strong bg-background px-3 text-sm underline underline-offset-4 hover:bg-surface disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void run(work, () => props.onRetry(entry))}
                    >
                      Retry
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex min-w-0 flex-wrap items-center gap-3 border-t border-line pt-5" aria-label={`Ordering and deletion for ${work.title}`}>
        <span className="text-xs uppercase tracking-wider text-muted">Order</span>
        <button
          type="button"
          aria-label={`Move ${work.title} up`}
          disabled={index === 0 || busy}
          className="min-h-11 min-w-11 border border-line-strong bg-background px-3 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void run(work, () => props.onMoveItem(work, "up"))}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${work.title} down`}
          disabled={index === total - 1 || busy}
          className="min-h-11 min-w-11 border border-line-strong bg-background px-3 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => void run(work, () => props.onMoveItem(work, "down"))}
        >
          ↓
        </button>
        <span className="text-sm text-muted">Position {index + 1} of {total}. Public order follows immediately.</span>
        <span className="flex-1" />
        {confirmingDelete ? (
          <span className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy}
              onClick={() => void run(work, async () => {
                await props.onDelete(work);
                setConfirmingDelete(false);
              })}
            >
              {busy ? "Deleting…" : "Yes, delete it"}
            </button>
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setConfirmingDelete(false)}>
              Keep the work
            </button>
          </span>
        ) : (
          <button type="button" className={dangerButtonClass} disabled={busy} onClick={() => setConfirmingDelete(true)}>
            Delete work
          </button>
        )}
      </section>
      {confirmingDelete ? (
        <p className="text-sm leading-6 text-muted">
          Deleting removes the stored files too{work.published ? ", including the public copies," : ""} and cannot be undone.
        </p>
      ) : null}
    </article>
  );
}

function AssetRow({
  work, asset, assetIndex, assetCount, busy, onSaveCaption, onMoveAsset, run,
}: {
  work: ManagedWork;
  asset: ManagedAsset;
  assetIndex: number;
  assetCount: number;
  busy: boolean;
  onSaveCaption: (work: ManagedWork, asset: ManagedAsset, value: string) => Promise<void>;
  onMoveAsset: (work: ManagedWork, asset: ManagedAsset, direction: "up" | "down") => Promise<void>;
  run: (work: ManagedWork, action: () => Promise<void>) => Promise<void>;
}) {
  const [savingCaption, setSavingCaption] = useState(false);
  const missing = asset.altText.trim().length === 0;
  const isVideo = asset.contentType === "video/mp4";

  return (
    <li className="flex min-w-0 flex-col gap-3 border border-line bg-background p-3 sm:flex-row sm:items-start">
      <div className="flex h-24 w-full shrink-0 items-center justify-center overflow-hidden border border-line bg-surface sm:h-24 sm:w-32">
        {asset.previewUrl ? (
          isVideo ? (
            <video
              src={asset.previewUrl}
              preload="metadata"
              muted
              playsInline
              aria-label={`Private preview of a video: ${asset.altText || "no description yet"}`}
              className="h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- private signed preview
            <img
              src={asset.previewUrl}
              alt={asset.altText || "Private preview of an image without a description yet"}
              width={asset.width ?? undefined}
              height={asset.height ?? undefined}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <span className="px-2 text-center text-xs text-muted">Preview unavailable</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="min-w-0 break-words text-xs uppercase tracking-wider text-muted">
          {isVideo ? "Video (H.264 MP4)" : "Image"} · {asset.width ?? "?"}×{asset.height ?? "?"}
          {missing ? <span className="ml-2 normal-case tracking-normal text-danger">Missing description — required before publishing</span> : null}
        </p>
        <form
          className="flex min-w-0 flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(new FormData(event.currentTarget).get("alt") ?? "");
            void (async () => {
              setSavingCaption(true);
              try {
                await run(work, () => onSaveCaption(work, asset, value));
              } finally {
                setSavingCaption(false);
              }
            })();
          }}
        >
          <Field
            label={`Description (alt text) for media ${assetIndex + 1} of ${assetCount}`}
            hint={work.published
              ? "Unpublish this work before editing captions — the public copies keep the caption from publish time."
              : "Describe what this file shows. Each file keeps its own description."}
          >
            <input
              name="alt"
              id={`alt-${asset.id}`}
              defaultValue={asset.altText}
              disabled={work.published || busy || savingCaption}
              aria-invalid={missing || undefined}
              className={inputClass}
            />
          </Field>
          {work.published ? null : (
            <div>
              <button type="submit" className={secondaryButtonClass} disabled={busy || savingCaption}>
                {savingCaption ? "Saving…" : "Save caption"}
              </button>
            </div>
          )}
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted">Media order</span>
          <button
            type="button"
            aria-label={`Move media ${assetIndex + 1} of ${work.title} earlier`}
            disabled={assetIndex === 0 || busy || work.published}
            title={work.published ? "Unpublish to reorder media" : undefined}
            className="min-h-11 min-w-11 border border-line-strong bg-background px-3 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void run(work, () => onMoveAsset(work, asset, "up"))}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move media ${assetIndex + 1} of ${work.title} later`}
            disabled={assetIndex === assetCount - 1 || busy || work.published}
            title={work.published ? "Unpublish to reorder media" : undefined}
            className="min-h-11 min-w-11 border border-line-strong bg-background px-3 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void run(work, () => onMoveAsset(work, asset, "down"))}
          >
            ↓
          </button>
        </div>
      </div>
    </li>
  );
}
