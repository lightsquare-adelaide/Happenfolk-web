"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { primaryButtonClass } from "@/components/field";

/** Reserve a paid seat and continue to the simulated gateway. */
export function RegisterButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function register() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/register`, { method: "POST" });
      const data = await response.json() as { orderId?: string; status?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not register. Please try again.");
      if (data.orderId) router.push(`/dashboard/orders/${data.orderId}`);
      else if (data.status === "confirmed") router.push("/dashboard/registrations?notice=already_registered");
      else throw new Error("Could not load your order. Please try again.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not register. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <button type="button" onClick={register} disabled={pending} className={primaryButtonClass}>
        {pending ? "Registering…" : "Continue to simulated payment"}
      </button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
