"use client";

import { useActionState } from "react";
import { cancelMyRegistration, type CancelState } from "./actions";

const initial: CancelState = { error: null };

export function CancelRegistrationForm({ registrationId }: { registrationId: string }) {
  const [state, formAction, pending] = useActionState(cancelMyRegistration, initial);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="registrationId" value={registrationId} />
      <button type="submit" disabled={pending} className="rounded border border-line px-2 py-1 text-sm disabled:opacity-50">
        {pending ? "Cancelling…" : "Cancel registration"}
      </button>
      {state.error ? <span role="alert" className="text-sm text-red-600">{state.error}</span> : null}
    </form>
  );
}
