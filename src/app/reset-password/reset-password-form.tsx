"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Landing target of the recovery email. The browser client detects the
 * `?code=` in the URL and exchanges it for a recovery session; once the
 * PASSWORD_RECOVERY event arrives the user picks a new password.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    router.replace("/dashboard");
    router.refresh();
  }

  if (done) {
    return <p className="text-sm text-muted">Password updated. Taking you to your dashboard…</p>;
  }

  if (!recovery) {
    return (
      <p className="max-w-sm text-sm text-muted">
        Open this page from the link in your reset email. The link signs you in and lets you
        set a new password. Didn’t get one? Go back to “Forgot password” to send it again.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        New password (at least 6 characters)
        <input
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}
