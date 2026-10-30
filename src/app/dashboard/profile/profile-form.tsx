"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, inputClass, primaryButtonClass } from "@/components/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { handleProblem } from "@/lib/onboarding";
import { BIO_MAX, DISPLAY_NAME_MAX } from "@/lib/profile";
import { updateProfile, type ProfileState } from "./actions";

type Category = { id: number; name: string };
type Profile = {
  handle: string; display_name: string; account_kind: "individual" | "organisation";
  category_id: number; bio: string | null; contact_email: string | null;
  open_to_collaborate: boolean; published: boolean;
};

export function ProfileForm({ profile, categories }: { profile: Profile; categories: Category[] }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(updateProfile, { error: null, saved: false });
  const [handle, setHandle] = useState(profile.handle);
  const [availability, setAvailability] = useState<"idle" | "checking" | "free" | "taken">("idle");
  const problem = handleProblem(handle);
  const unchanged = handle === profile.handle;

  // A successful save must be reflected immediately in the site header
  // (root layout), which shows the handle: re-fetch the current route
  // tree without a document reload, keeping the saved message and every
  // typed field intact. Depends on the action-result object so a SECOND
  // save (saved stays true) also refreshes.
  useEffect(() => {
    if (state.saved) router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (problem || unchanged) return;
    let active = true;
    const timer = setTimeout(async () => {
      setAvailability("checking");
      const { data, error } = await createSupabaseBrowserClient().rpc("handle_available", { p_handle: handle });
      if (active) setAvailability(error ? "idle" : data === true ? "free" : "taken");
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [handle, problem, unchanged]);

  const taken = !problem && !unchanged && availability === "taken";
  const handleStatus = problem ?? (unchanged ? "This is your current handle."
    : availability === "checking" ? "Checking availability…"
    : availability === "free" ? "Available."
    : taken ? "Already taken. Choose another handle." : "");

  return (
    <form action={formAction} aria-busy={pending} className="min-w-0">
      <h2 className="font-display text-[32px] leading-tight">Profile details</h2>
      <fieldset disabled={pending} className="mt-6 flex min-w-0 flex-col gap-6">
        <Field label="Display name" hint="The name visitors see beside your work.">
          <input name="displayName" required maxLength={DISPLAY_NAME_MAX} defaultValue={profile.display_name} className={inputClass} autoComplete="name" />
        </Field>
        <div>
          <Field label="Handle" hint="3–30 lowercase letters, digits or underscores. Changing it changes your page address.">
            <input name="handle" required maxLength={30} value={handle}
              onChange={(event) => { setHandle(event.target.value.toLowerCase()); setAvailability("idle"); }}
              aria-describedby="handle-status" aria-invalid={Boolean(problem) || taken}
              autoCapitalize="none" autoComplete="username" spellCheck={false} className={inputClass + " font-mono"} />
          </Field>
          <p id="handle-status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">{handleStatus}</p>
        </div>
        <div className="grid min-w-0 gap-6 sm:grid-cols-2">
          <fieldset className="min-w-0">
            <legend className="mb-3 text-sm font-medium">Account type</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm">
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" name="accountKind" value="individual" className="accent-brand" defaultChecked={profile.account_kind === "individual"} required /> Individual
              </label>
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" name="accountKind" value="organisation" className="accent-brand" defaultChecked={profile.account_kind === "organisation"} required /> Organisation
              </label>
            </div>
          </fieldset>
          <Field label="Category">
            <select name="categoryId" required defaultValue={profile.category_id} className={inputClass}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Bio" hint={"Tell visitors about your practice, in up to " + BIO_MAX + " characters."}>
          <textarea name="bio" rows={6} maxLength={BIO_MAX} defaultValue={profile.bio ?? ""} className={inputClass + " resize-y leading-7"} />
        </Field>
        <Field label="Contact email (optional)" hint="Saving an address opts in to showing it on your published profile. Clear it to withdraw consent. Your sign-in email is never copied here.">
          <input name="contactEmail" type="email" defaultValue={profile.contact_email ?? ""} className={inputClass} autoComplete="email" placeholder="studio@example.org" />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 border border-line bg-surface p-5">
          <input type="checkbox" name="openToCollaborate" defaultChecked={profile.open_to_collaborate} className="mt-1 shrink-0 accent-brand" />
          <span className="min-w-0">
            <span className="block font-medium">Open to collaboration</span>
            <span className="mt-1 block text-sm leading-6 text-muted">List my published profile in the collaboration directory so other practitioners and hosts can get in touch.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 border border-line bg-surface p-5">
          <input type="checkbox" name="published" defaultChecked={profile.published} className="mt-1 shrink-0 accent-brand" />
          <span className="min-w-0">
            <span className="block font-medium">Publish my profile so anyone can see it</span>
            <span className="mt-1 block text-sm leading-6 text-muted">Turn this off to hide your profile. Your avatar is public independently of this setting.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button type="submit" disabled={pending || taken || Boolean(problem)} className={primaryButtonClass}>{pending ? "Saving…" : "Save profile"}</button>
          <p aria-live="polite" role="status" className="text-sm">{state.error ?? (state.saved ? "Profile saved." : "")}</p>
        </div>
      </fieldset>
    </form>
  );
}
