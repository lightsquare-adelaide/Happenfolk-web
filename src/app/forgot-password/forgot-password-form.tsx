"use client";

import { useState } from "react";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { Field, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";

/**
 * Request a password reset email. Flow unchanged from the audited baseline:
 * resetPasswordForEmail with a same-origin redirectTo.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/reset-password`,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex w-full flex-col gap-5">
        <FormAlert tone="success">
          Reset email sent to {email || "your address"}.
        </FormAlert>
        <p className="max-w-md text-sm leading-6 text-muted">
          Open the link in that email to choose a new password. The link signs you in for that one
          step, so use the same browser you requested it from. On the local stack the mail arrives
          in the Mailpit inbox.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className={secondaryButtonClass}>
            Back to log in
          </Link>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="self-start text-sm text-muted underline decoration-line-strong underline-offset-4 hover:text-foreground"
          >
            Send to a different address
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-busy={busy} className="flex w-full flex-col gap-5">
      <Field label="Email" hint="The address your account was created with.">
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

      {error ? <FormAlert tone="danger">{error}</FormAlert> : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? "Sending…" : "Send reset email"}
        </button>
        <Link
          href="/login"
          className="text-sm text-muted underline decoration-line-strong underline-offset-4 hover:text-foreground"
        >
          Back to log in
        </Link>
      </div>
    </form>
  );
}
