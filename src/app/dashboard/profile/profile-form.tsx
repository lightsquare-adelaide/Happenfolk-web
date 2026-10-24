"use client";

import { useActionState, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { handleProblem } from "@/lib/onboarding";
import { BIO_MAX, DISPLAY_NAME_MAX } from "@/lib/profile";
import { updateProfile, type ProfileState } from "./actions";

type Category = { id: number; name: string };
type Profile = {
  handle: string;
  display_name: string;
  account_kind: "individual" | "organisation";
  category_id: number;
  bio: string | null;
  published: boolean;
};

const fieldClass = "rounded-md border border-line bg-surface px-3 py-2";

export function ProfileForm({ profile, categories }: { profile: Profile; categories: Category[] }) {
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(updateProfile, {
    error: null,
    saved: false,
  });
  const [handle, setHandle] = useState(profile.handle);
  const [availability, setAvailability] = useState<"idle" | "checking" | "free" | "taken">(
    "idle",
  );
  const problem = handleProblem(handle);
  // The member's own current handle reads as taken to the RPC, so skip it.
  const unchanged = handle === profile.handle;

  // Same debounced SECURITY DEFINER check as onboarding.
  useEffect(() => {
    if (problem || unchanged) return;
    const timer = setTimeout(async () => {
      setAvailability("checking");
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("handle_available", { p_handle: handle });
      if (error) {
        setAvailability("idle");
        return;
      }
      setAvailability(data === true ? "free" : "taken");
    }, 300);
    return () => clearTimeout(timer);
  }, [handle, problem, unchanged]);

  const taken = !problem && !unchanged && availability === "taken";

  return (
    <form action={formAction} className="flex w-full max-w-lg flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Display name
        <input
          name="displayName"
          required
          maxLength={DISPLAY_NAME_MAX}
          defaultValue={profile.display_name}
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Handle (3–30 lowercase letters, digits or underscores)
        <input
          name="handle"
          required
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value.toLowerCase());
            // Clear the previous handle's result so it never shows for the new one.
            setAvailability("idle");
          }}
          aria-describedby="handle-status"
          className={`${fieldClass} font-mono`}
        />
      </label>
      <p
        id="handle-status"
        aria-live="polite"
        className={`text-xs ${
          taken
            ? "text-red-600"
            : !problem && !unchanged && availability === "free"
              ? "text-green-700"
              : "text-muted"
        }`}
      >
        {problem ??
          (unchanged
            ? ""
            : availability === "checking"
              ? "Checking…"
              : availability === "free"
                ? "✓ Available"
                : taken
                  ? "Already taken"
                  : "")}
      </p>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1">Account type</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="accountKind"
            value="individual"
            defaultChecked={profile.account_kind === "individual"}
            required
          />
          Individual
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="accountKind"
            value="organisation"
            defaultChecked={profile.account_kind === "organisation"}
            required
          />
          Organisation
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Category
        <select
          name="categoryId"
          required
          defaultValue={profile.category_id}
          className={fieldClass}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Bio
        <textarea
          name="bio"
          rows={5}
          maxLength={BIO_MAX}
          defaultValue={profile.bio ?? ""}
          className={fieldClass}
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="published" defaultChecked={profile.published} />
        Publish my profile so anyone can see it
      </label>

      <p aria-live="polite" className="text-sm">
        {state.error ? (
          <span className="text-red-600">{state.error}</span>
        ) : state.saved ? (
          <span className="text-green-700">Profile saved.</span>
        ) : null}
      </p>

      <button
        type="submit"
        disabled={pending || taken}
        className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
