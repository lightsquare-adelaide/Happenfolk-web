"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, secondaryButtonClass } from "@/components/field";

export function AvatarUpload({ currentUrl = null }: { currentUrl?: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/media/avatar", { method: "POST", body: form });
      const data = await response.json() as { error?: string; cleanupPending?: boolean };
      setMessage(response.ok
        ? data.cleanupPending ? "Avatar saved. The previous public avatar still needs cleanup." : "Avatar saved."
        : data.error ?? "Upload failed.");
      if (response.ok) {
        if (input.current) input.current.value = "";
        router.refresh();
      }
    } catch { setMessage("Upload failed. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={upload} aria-busy={busy} className="flex min-w-0 flex-col items-start gap-4">
      <h2 className="font-display text-[32px] leading-tight">Avatar</h2>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- public user avatar
        <img src={currentUrl} width={160} height={160} alt="Your current public avatar" className="h-40 w-40 border border-line object-cover" />
      ) : null}
      <p className="text-sm leading-6 text-muted">Your avatar is public, even while your profile is hidden. Choose an image you have permission to use.</p>
      <label htmlFor="avatar-file" className="text-sm font-medium">Choose avatar image</label>
      <input ref={input} id="avatar-file" type="file" accept=".jpg,.jpeg,.png,.webp" required disabled={busy}
        aria-describedby="avatar-help" className={inputClass + " min-w-0 text-sm file:mr-3 file:border-0 file:bg-surface file:px-2 file:py-1 file:text-foreground"} />
      <p id="avatar-help" className="text-xs leading-5 text-muted">JPEG, PNG or WebP, up to 4 MiB.</p>
      <button type="submit" disabled={busy} className={secondaryButtonClass}>{busy ? "Uploading…" : "Upload avatar"}</button>
      <p role="status" aria-live="polite" className="text-sm">{message}</p>
    </form>
  );
}
