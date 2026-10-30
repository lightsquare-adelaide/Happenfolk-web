"use client";

import { RegisterButton } from "@/components/register-button";
import { useActionState } from "react";
import { primaryButtonClass } from "@/components/field";
import { registerForFreeEvent, type RegistrationActionState } from "./participation-actions";

const initialState: RegistrationActionState = { error: null };

export function ParticipateForm({ eventId, priceCents = 0 }: { eventId: string; priceCents?: number }) {
  return priceCents > 0 ? <RegisterButton eventId={eventId} /> : <FreeParticipateForm eventId={eventId} />;
}

function FreeParticipateForm({ eventId }: { eventId: string }) {
  const [state, action, pending] = useActionState(registerForFreeEvent, initialState);
  return (
    <form action={action} className="flex flex-col items-start gap-4">
      <input type="hidden" name="eventId" value={eventId} />
      {state.error ? <p role="alert" className="text-sm leading-6 text-danger">{state.error}</p> : null}
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Registering…" : "Participate · Free"}
      </button>
    </form>
  );
}
