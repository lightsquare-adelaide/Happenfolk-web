"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function RegisterForm() {
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
    router.replace("/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password (at least 6 characters)
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
        {busy ? "Signing up…" : "Sign up"}
      </button>
      <Link href="/login" className="text-center text-sm text-muted underline">
        Already have an account? Log in
      </Link>
    </form>
  );
}
