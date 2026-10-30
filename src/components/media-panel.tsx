"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Dashboard media panel: drag-drop + multi-file uploads with per-file
 * progress, publish/unpublish with server-enforced alt text, and
 * arrow-key reordering. The browser never decides validity — every
 * file goes through /api/media/upload where bytes are sniffed; client
 * hints (extension check, accept attr) exist only for instant feedback.
 */

export type PanelAsset = {
  id: string;
  path: string;
  altText: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  position: number;
};

export type PanelItem = {
  id: string;
  title: string;
  mediaKind: string;
  published: boolean;
  assets: PanelAsset[];
};

type UploadState = { key: string; name: string; progress: number; status: "uploading" | "done" | "failed"; message?: string };

const ACCEPTED = ".jpg,.jpeg,.png,.webp,.mp4";

/** Extensions the pipeline accepts — UX pre-filter only. */
function looksAccepted(name: string): boolean {
  return /\.(jpe?g|png|webp|mp4)$/i.test(name);
}

export function MediaPanel({ items }: { items: PanelItem[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});
  const [targetItem, setTargetItem] = useState("");
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const uploadOne = useCallback(
    (file: File) =>
      new Promise<void>((resolve) => {
        const key = crypto.randomUUID();
        setUploads((prev) => [...prev, { key, name: file.name, progress: 0, status: "uploading" }]);
        const form = new FormData();
        form.append("file", file);
        if (targetItem) form.append("itemId", targetItem);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/media/upload");
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploads((prev) => prev.map((u) => (u.key === key && u.status === "uploading" ? { ...u, progress } : u)));
        };
        xhr.onload = () => {
          const failed = xhr.status !== 201;
          let message: string | undefined;
          if (failed) {
            try {
              message = (JSON.parse(xhr.responseText) as { error?: string; hint?: string }).error;
            } catch {
              message = `Upload failed (${xhr.status})`;
            }
          }
          setUploads((prev) =>
            prev.map((u) =>
              u.key === key && u.status === "uploading"
                ? { ...u, progress: failed ? u.progress : 100, status: failed ? "failed" : "done", message }
                : u,
            ),
          );
          resolve();
        };
        xhr.onerror = () => {
          setUploads((prev) => prev.map((u) => (u.name === file.name ? { ...u, status: "failed", message: "Network error" } : u)));
          resolve();
        };
        xhr.send(form);
      }),
    [targetItem],
  );

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files];
      const rejected = list.filter((f) => !looksAccepted(f.name) || f.size > 4 * 1024 * 1024);
      for (const f of rejected) {
        setUploads((prev) => [...prev, { key: crypto.randomUUID(), name: f.name, progress: 0, status: "failed", message: "Choose JPG/PNG/WebP/MP4 up to 4 MiB" }]);
      }
      for (const file of list.filter((f) => looksAccepted(f.name) && f.size <= 4 * 1024 * 1024)) await uploadOne(file);
      router.refresh();
    },
    [router, uploadOne],
  );

  async function postJson(url: string, body: unknown): Promise<string | null> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  }

  async function act(itemId: string, fn: () => Promise<string | null>) {
    setBusyItem(itemId);
    let problem: string | null;
    try { problem = await fn(); } catch { problem = "Request failed. Please try again."; }
    finally { setBusyItem(null); }
    if (problem) {
      setUploads((prev) => [...prev, { key: crypto.randomUUID(), name: itemId, progress: 0, status: "failed", message: problem }]);
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Media upload">
      <label className="flex flex-col gap-1 text-sm">Upload destination
        <select value={targetItem} onChange={event => setTargetItem(event.target.value)} className="rounded border border-line p-2">
          <option value="">Create a new draft work for each file</option>
          {items.filter(item => !item.published).map(item => <option key={item.id} value={item.id}>{item.title} — existing draft</option>)}
        </select>
      </label>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload media: drag and drop or click to choose files"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-8 text-center transition-colors ${
          dragging ? "border-foreground bg-tint" : "border-line bg-surface"
        }`}
      >
        <span className="font-medium">Drag files here, or click to choose</span>
        <span className="text-sm text-muted">
          JPG / PNG / WebP / MP4 (H.264), up to 4 MiB each, multiple files allowed. The type is judged from file content, not the extension.
        </span>
        <input
          ref={inputRef}
          type="file"
          aria-label="Choose media files to upload"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center justify-between gap-3 rounded border border-line bg-surface px-3 py-2">
              <span className="truncate">{u.name}</span>
              {u.status === "uploading" && <span className="text-muted">{u.progress}%</span>}
              {u.status === "done" && <span className="text-green-700">Uploaded</span>}
              {u.status === "failed" && <span className="text-red-700">{u.message ?? "Failed"}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted">No work items yet: the first upload automatically creates a draft item.</p>
        ) : (
          items.map((item) => (
            <article key={item.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
              <header className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{item.title}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs ${item.published ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                  {item.published ? "Published" : "Draft"}
                </span>
              </header>

              <ul className="flex flex-col gap-1 text-sm">
                {item.assets.map((asset, index) => (
                  <li key={asset.id} className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2">
                    <span className="truncate">
                      {asset.contentType} · {asset.width ?? "?"}×{asset.height ?? "?"} ·{" "}
                      {asset.altText ? "Has alt text" : <span className="text-red-700">Missing alt text</span>}
                    </span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={index === 0 || busyItem === item.id}
                        onClick={() => void act(item.id, () => postJson("/api/media/reorder", { itemId: item.id, assetId: asset.id, direction: "up" }))}
                        className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={index === item.assets.length - 1 || busyItem === item.id}
                        onClick={() => void act(item.id, () => postJson("/api/media/reorder", { itemId: item.id, assetId: asset.id, direction: "down" }))}
                        className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium" htmlFor={`alt-${item.id}`}>
                  Alt text (required to publish)
                  <input
                    id={`alt-${item.id}`}
                    type="text"
                    value={altDrafts[item.id] ?? ""}
                    onChange={(e) => setAltDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    placeholder="Fill in alt text for all media (required to publish)"
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm font-normal"
                  />
                </label>
                {item.published ? (
                  <button
                    type="button"
                    disabled={busyItem === item.id}
                    onClick={() => void act(item.id, () => postJson("/api/media/unpublish", { itemId: item.id }))}
                    className="rounded border border-line px-3 py-1 text-sm disabled:opacity-50"
                  >
                    Unpublish
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyItem === item.id}
                    onClick={() => void act(item.id, () => postJson("/api/media/publish", { itemId: item.id, altText: altDrafts[item.id] ?? "" }))}
                    className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
