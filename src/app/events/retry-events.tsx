"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { secondaryButtonClass } from "@/components/field";

export function RetryEvents() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} className={secondaryButtonClass}
    onClick={() => startTransition(() => router.refresh())}>{pending ? "Retrying…" : "Retry events"}</button>;
}
