"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Props = {
  subjectType: "event" | "profile" | "portfolio_item";
  subjectId: string;
  initialCount: number;
  initialLiked: boolean;
  label?: string;
};

/**
 * Toggle button backed by POST /api/likes -> public.toggle_like.
 * Anonymous clicks redirect to /login?next=<current path>.
 */
export function LikeButton({
  subjectType,
  subjectId,
  initialCount,
  initialLiked,
  label = "Like",
}: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  function onClick() {
    startTransition(async () => {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId }),
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as {
        liked?: boolean;
        likeCount?: number;
      };
      if (typeof body.liked === "boolean") setLiked(body.liked);
      if (typeof body.likeCount === "number") setCount(body.likeCount);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-pressed={liked}
      className={`inline-flex min-h-11 items-center gap-2 border px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60 ${
        liked
          ? "border-foreground bg-foreground text-background"
          : "border-line bg-surface text-foreground hover:border-foreground"
      }`}
    >
      <span aria-hidden="true">{liked ? "♥" : "♡"}</span>
      <span>{liked ? "Liked" : label}</span>
      <span className="tabular-nums opacity-75">· {count}</span>
    </button>
  );
}
