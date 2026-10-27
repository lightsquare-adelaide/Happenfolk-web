"use client";

import { useActionState } from "react";
import { dangerButtonClass } from "@/components/field";
import { cancelMyRegistration, type CancelState } from "./actions";

const initial: CancelState = { error: null };

export function CancelRegistrationForm({ registrationId }: { registrationId: string }) {
  const [state, formAction, pending] = useActionState(cancelMyRegistration, initial);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="registrationId" value={registrationId} />
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        {pending ? "Cancelling…" : "Cancel registration"}
      </button>
      {state.error ? <span role="alert" className="text-sm leading-6 text-danger">{state.error}</span> : null}
    </form>
  );
}
