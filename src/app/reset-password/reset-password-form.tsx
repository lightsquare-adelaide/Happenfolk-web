"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormAlert } from "@/components/form-alert";
import { Field, cardClass, inputClass, primaryButtonClass } from "@/components/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Landing target of the recovery email. The browser client detects the
 * ?code= in the URL and exchanges it for a recovery session; once the
 * PASSWORD_RECOVERY event arrives the visitor chooses a new password.
 *
 * Three designed states, because all three are reachable in normal use:
 * arrived without a recovery link, link valid and waiting, password changed.
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
    return (
      <div className="flex w-full flex-col gap-5">
        <FormAlert tone="success">Password updated.</FormAlert>
        <p className="text-sm leading-6 text-muted">Taking you to your dashboard.</p>
      </div>
    );
  }

  if (!recovery) {
    return (
      <div className="flex w-full flex-col gap-5">
        <div className={cardClass}>
          <p className="text-sm leading-6 text-muted">
            Open this page from the link in your reset email. That link signs you in for one step
            and lets you set a new password. Visiting it directly is not enough, and an expired
            link has to be requested again.
          </p>
        </div>
        <Link href="/forgot-password" className={`${primaryButtonClass} self-start`}>
          Send a new reset email
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-busy={busy} className="flex w-full flex-col gap-5">
      <Field label="New password" hint="At least 6 characters">
        <input
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </Field>

      {error ? <FormAlert tone="danger">{error}</FormAlert> : null}

      <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
        {busy ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}
