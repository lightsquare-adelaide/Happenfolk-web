"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Thumbs Up on an event. toggle_like checks the member and that the event is published. */
export async function toggleEventLike(formData: FormData) {
  const id = String(formData.get("eventId") ?? "");
  const back = String(formData.get("back") ?? "/");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);
  const { error } = await supabase.rpc("toggle_like", { p_subject_type: "event", p_subject_id: id });
  if (error) console.error("toggleEventLike failed", error);
  revalidatePath(back);
}
