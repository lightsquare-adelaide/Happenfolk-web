"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormAlert } from "@/components/form-alert";
import { Field, inputClass, primaryButtonClass } from "@/components/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Password login. The auth behaviour is unchanged from the audited baseline
 * (browser client, signInWithPassword, redirect to a same-origin next path);
 * this file only carries the presentation.
 *
 * Field names are deliberately plain: "Email" and "Password" with no hint
 * inside the label, so the accessible name stays exactly what a person (or a
 * verification script) would say out loud.
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.replace(nextPath);
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

      <Field label="Password">
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </Field>

      {error ? <FormAlert tone="danger">{error}</FormAlert> : null}

      <button type="submit" disabled={busy} className={`${primaryButtonClass} w-full`}>
        {busy ? "Logging in…" : "Log in"}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
        <span className="text-muted">
          No account yet?{" "}
          <Link
            href={`/register?next=${encodeURIComponent(nextPath)}`}
            className="font-medium text-brand-text underline decoration-brand-line underline-offset-4 hover:decoration-brand"
          >
            Create account
          </Link>
        </span>
        <Link
          href="/forgot-password"
          className="text-muted underline decoration-line-strong underline-offset-4 hover:text-foreground"
        >
          Forgot password
        </Link>
      </div>
    </form>
  );
}
