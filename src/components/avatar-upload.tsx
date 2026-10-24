"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function AvatarUpload() {
  const router = useRouter(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const file = input.current?.files?.[0]; if (!file) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/media/avatar", { method: "POST", body: form });
      const data = await response.json() as { error?: string; cleanupPending?: boolean };
      setMessage(response.ok ? (data.cleanupPending ? "Avatar saved. The previous public avatar still needs cleanup." : "Avatar saved.") : data.error ?? "Upload failed.");
      if (response.ok) { if (input.current) input.current.value = ""; router.refresh(); }
    } catch { setMessage("Upload failed. Please try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={upload} className="flex max-w-lg flex-col gap-2 rounded border border-line p-4">
    <label htmlFor="avatar-file" className="font-medium">Avatar</label>
    <p className="text-sm text-muted">Your avatar is public. Choose a JPEG, PNG or WebP image you have permission to use (up to 4 MiB).</p>
    <input ref={input} id="avatar-file" type="file" accept=".jpg,.jpeg,.png,.webp" required disabled={busy} />
    <button type="submit" disabled={busy} className="rounded bg-brand-700 px-3 py-2 text-white disabled:opacity-50">{busy ? "Uploading…" : "Upload avatar"}</button>
    <p role="status" className="text-sm">{message}</p>
  </form>;
}
