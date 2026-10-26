"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormAlert } from "@/components/form-alert";
import { Field, inputClass, primaryButtonClass } from "@/components/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Sign up. Behaviour is the audited baseline: signUp on the browser client,
 * then onboarding, because the local stack has enable_confirmations = false
 * and returns a session immediately. Presentation only changes here.
 */
export function RegisterForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    // Local stack has enable_confirmations = false: signup returns a
    // session and the user goes straight into onboarding.
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    if (!data.session) {
      setError(
        "Signed up, but no session was returned. Ask an administrator to check the email confirmation settings.",
      );
      setBusy(false);
      return;
    }
    router.replace(`/onboarding?next=${encodeURIComponent(nextPath)}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-busy={busy} className="flex w-full flex-col gap-5">
      <Field label="Email">
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Password" hint="At least 6 characters">
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
        {busy ? "Signing up…" : "Create account"}
      </button>

      <p className="border-t border-line pt-4 text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="font-medium text-brand-text underline decoration-brand-line underline-offset-4 hover:decoration-brand"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}
