"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/field";

type Props = {
  orderId: string;
  eventId: string;
  orderStatus: string;
  registrationStatus: string;
};

/** Outcome is chosen for this order alone; no payment details are collected. */
export function GatewayControls({ orderId, eventId, orderStatus, registrationStatus }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(orderStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(outcome?: "succeeded" | "failed") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(outcome ? `/api/orders/${orderId}/settle` : `/api/events/${eventId}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(outcome ? { body: JSON.stringify({ outcome }) } : {}),
      });
      const data = await response.json() as { orderStatus?: string; orderId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update payment. Please try again.");
      if (!outcome) {
        if (!data.orderId) throw new Error("Could not load your new order. Please try again.");
        router.push(`/dashboard/orders/${data.orderId}`);
      } else {
        if (data.orderStatus !== "succeeded" && data.orderStatus !== "failed") throw new Error("Could not read payment status. Please refresh.");
        setStatus(data.orderStatus);
        router.refresh();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update payment. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {registrationStatus === "cancelled" ? (
        <p role="status" className="text-muted">This registration is cancelled. Register again from the event to reserve a place before paying.</p>
      ) : status === "succeeded" ? (
        <p role="status" className="font-medium text-success">Payment succeeded, registration confirmed.</p>
      ) : status === "failed" && registrationStatus === "confirmed" ? (
        <p role="status" className="text-muted">This failed order is kept in your history. Your registration is confirmed by another order.</p>
      ) : status === "failed" ? (
        <div className="space-y-4">
          <p role="status" className="text-danger">Payment failed. Your place stays reserved until you retry or cancel. This failed order stays in your history.</p>
          <button type="button" disabled={busy} onClick={() => submit()} className={primaryButtonClass}>
            {busy ? "Retrying…" : "Retry payment (creates a new order)"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => submit("succeeded")} className={primaryButtonClass}>Payment succeeded</button>
          <button type="button" disabled={busy} onClick={() => submit("failed")} className={secondaryButtonClass}>Payment failed (simulated)</button>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <Link href="/dashboard/registrations" className="inline-block py-2 text-sm underline underline-offset-4">My registrations</Link>
    </div>
  );
}
