"use client";

import { useActionState, useEffect, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Field, inputClass, primaryButtonClass, selectClass } from "@/components/field";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { handleProblem, type AccountKind } from "@/lib/onboarding";
import { completeOnboarding, type OnboardingState } from "./actions";

type Category = { id: number; name: string };

type Availability = "idle" | "checking" | "free" | "taken";

/**
 * Onboarding: account kind, category, public handle.
 *
 * All logic is the audited baseline (useActionState against the existing
 * server action, a 300ms debounced handle_available RPC asked as the anonymous
 * public, and the "your own prefilled handle is not taken" rule). This file
 * changes presentation only.
 *
 * The live availability line keeps the strings the acceptance journey reads
 * ("Already taken", "Available"), and it is wired to the handle field through
 * aria-describedby as well as aria-live, so the result is announced and also
 * belongs to the field it describes.
 */
export function OnboardingForm({
  categories,
  currentHandle,
  nextPath,
}: {
  categories: Category[];
  currentHandle: string | null;
  nextPath: string;
}) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    { error: null },
  );
  const [handle, setHandle] = useState(currentHandle ?? "");
  const [availability, setAvailability] = useState<Availability>("idle");

  // Derived at render: when the handle violates the shape rules we never even
  // query, and we avoid synchronous setState in the effect
  // (react-hooks/set-state-in-effect).
  const problem = handleProblem(handle);
  const unchanged = handle === currentHandle;

  // Live availability check: debounce 300ms, then ask the SECURITY DEFINER RPC
  // as the anonymous public would, never by reading the profiles table.
  useEffect(() => {
    if (problem || unchanged) return;
    let active = true;
    const timer = setTimeout(async () => {
      setAvailability("checking");
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.rpc("handle_available", { p_handle: handle });
      if (!active) return;
      if (error) {
        setAvailability("idle");
        return;
      }
      setAvailability(data === true ? "free" : "taken");
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [handle, problem, unchanged]);

  const taken = !problem && !unchanged && availability === "taken";
  const free = !problem && !unchanged && availability === "free";

  const status = problem
    ? problem
    : unchanged
      ? "This is your current handle"
      : availability === "checking"
        ? "Checking availability"
        : free
          ? "Available"
          : taken
            ? "Already taken"
            : "";

  const statusTone = problem
    ? "text-danger"
    : taken
      ? "text-danger"
      : free
        ? "text-success"
        : "text-muted";

  return (
    <form action={formAction} aria-busy={pending} className="flex w-full flex-col gap-6">
      <input type="hidden" name="next" value={nextPath} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Account type</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 border border-line-strong bg-surface p-3 transition-colors duration-200 hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input
              type="radio"
              name="accountKind"
              value="individual"
              defaultChecked
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Individual</span>
              <span className="text-xs leading-5 text-muted">One artist, one profile</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 border border-line-strong bg-surface p-3 transition-colors duration-200 hover:border-brand has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
            <input
              type="radio"
              name="accountKind"
              value="organisation"
              required
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Organisation</span>
              <span className="text-xs leading-5 text-muted">A collective, studio or venue</span>
            </span>
          </label>
        </div>
      </fieldset>

      <Field label="Category" hint="The discipline your work is filed under. You can change it later.">
        <select name="categoryId" required defaultValue="" className={selectClass}>
          <option value="" disabled>
            Choose your category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Handle" hint="3 to 30 lowercase letters, digits or underscores" mono>
        <input
          name="handle"
          required
          value={handle}
          onChange={(event) => {
            setHandle(event.target.value.toLowerCase());
            setAvailability("idle");
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="handle-status"
          className={inputClass}
        />
      </Field>

      <div className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
        <p className="text-xs text-muted">
          Your public address:{" "}
          <span className="font-mono text-foreground">/artists/{handle || "handle"}</span>
        </p>
        <p id="handle-status" aria-live="polite" className={`text-sm font-medium ${statusTone}`}>
          {status}
        </p>
      </div>

      {state.error ? <FormAlert tone="danger">{state.error}</FormAlert> : null}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={pending || taken || Boolean(problem)}
          className={`${primaryButtonClass} w-full`}
        >
          {pending ? "Saving…" : "Finish and continue"}
        </button>
        <p className="text-xs leading-5 text-muted">
          Your profile stays hidden until you publish it from the dashboard.
        </p>
      </div>
    </form>
  );
}

/** Kept so importing modules keep one source for the account kind union. */
export type { AccountKind };
