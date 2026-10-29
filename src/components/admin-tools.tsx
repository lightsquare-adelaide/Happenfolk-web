"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inputClass } from "@/components/field";

type Props = {
  subjectType: "profile" | "portfolio_item" | "event";
  subjectId: string;
  hidden: boolean;
  fields: Record<string, string>;
};

/**
 * Staff controls for a single row on /admin:
 * - Hide / Unhide button -> POST /api/admin/set-hidden
 * - Expandable inline editor -> POST /api/admin/update
 */
export function AdminTools({ subjectType, subjectId, hidden, fields }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(fields);
  const [error, setError] = useState<string | null>(null);

  function toggleHidden() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/set-hidden", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, hidden: !hidden }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    });
  }

  function saveEdits(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/admin/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, fields: values }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggleHidden}
          disabled={isPending}
          className={`min-h-11 border px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 ${
            hidden
              ? "border-brand bg-brand text-on-brand"
              : "border-line bg-surface text-foreground hover:border-foreground"
          }`}
        >
          {hidden ? "Unhide" : "Hide"}
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="min-h-11 border border-line bg-surface px-3 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-muted transition-colors hover:border-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {editing ? "Close" : "Edit"}
        </button>
        {error && (
          <span role="alert" className="font-mono text-xs text-danger">
            {error}
          </span>
        )}
      </div>

      {editing && (
        <form
          onSubmit={saveEdits}
          className="space-y-3 border border-line bg-surface p-4"
        >
          {Object.keys(values).map((k) => (
            <label key={k} className="block space-y-1 text-xs">
              <span className="font-mono uppercase tracking-[0.12em] text-muted">
                {k.replace(/_/g, " ")}
              </span>
              <input
                type="text"
                value={values[k] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [k]: e.target.value }))
                }
                className={inputClass}
              />
            </label>
          ))}
          <button
            type="submit"
            disabled={isPending}
            className="min-h-11 border border-foreground bg-foreground px-4 py-1.5 font-mono text-xs uppercase tracking-[0.14em] text-background disabled:opacity-60"
          >
            Save changes
          </button>
        </form>
      )}
    </div>
  );
}
