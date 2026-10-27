"use client";

import { useActionState } from "react";
import { registerForFreeEvent, type RegistrationActionState } from "./participation-actions";

const initialState: RegistrationActionState = { error: null };

export function ParticipateForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(registerForFreeEvent, initialState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      {state.error ? <p role="alert" className="text-sm text-red-600">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="rounded-md bg-brand-700 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Registering…" : "Participate in this free event"}
      </button>
    </form>
  );
}
