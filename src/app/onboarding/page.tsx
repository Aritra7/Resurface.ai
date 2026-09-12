"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

const suggestedGoals = [
  "Learn something",
  "Improve fitness",
  "Grow my career",
  "Cook more",
  "Plan a trip",
  "Enjoy downtime",
];

type Draft = {
  displayName: string;
  goals: string[];
  primaryGoal: string;
  defaultMinutes: 5 | 10 | 20;
};

const emptyDraft: Draft = {
  displayName: "",
  goals: [],
  primaryGoal: "",
  defaultMinutes: 10,
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => {
    if (typeof window === "undefined") return emptyDraft;
    const stored = window.localStorage.getItem("resurface-onboarding-draft");
    if (!stored) return emptyDraft;

    try {
      return { ...emptyDraft, ...JSON.parse(stored) };
    } catch {
      window.localStorage.removeItem("resurface-onboarding-draft");
      return emptyDraft;
    }
  });
  const [customGoal, setCustomGoal] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!data.user) router.replace("/login");
        else setLoading(false);
      });
  }, [router]);

  useEffect(() => {
    if (!loading) {
      window.localStorage.setItem("resurface-onboarding-draft", JSON.stringify(draft));
    }
  }, [draft, loading]);

  const progress = useMemo(() => ((step + 1) / 3) * 100, [step]);

  function toggleGoal(goal: string) {
    setError("");
    setDraft((current) => {
      const selected = current.goals.includes(goal);
      if (!selected && current.goals.length === 3) {
        setError("Start with three goals—you can add more later.");
        return current;
      }

      const goals = selected
        ? current.goals.filter((item) => item !== goal)
        : [...current.goals, goal];
      return {
        ...current,
        goals,
        primaryGoal: goals.includes(current.primaryGoal) ? current.primaryGoal : "",
      };
    });
  }

  function addCustomGoal() {
    const goal = customGoal.trim();
    if (!goal) return;
    if (goal.length > 40) {
      setError("Keep a custom goal under 40 characters.");
      return;
    }
    if (draft.goals.some((item) => item.toLowerCase() === goal.toLowerCase())) {
      setError("That goal is already selected.");
      return;
    }
    if (draft.goals.length === 3) {
      setError("Start with three goals—you can add more later.");
      return;
    }
    setDraft((current) => ({ ...current, goals: [...current.goals, goal] }));
    setCustomGoal("");
    setError("");
  }

  function continueFromGoals() {
    if (!draft.displayName.trim()) {
      setError("Tell us what we should call you.");
      return;
    }
    if (draft.goals.length === 0) {
      setError("Choose at least one goal.");
      return;
    }
    if (draft.goals.length === 1) {
      setDraft((current) => ({ ...current, primaryGoal: current.goals[0] }));
      setStep(2);
    } else {
      setStep(1);
    }
    setError("");
  }

  async function finish() {
    const primaryGoal = draft.primaryGoal || draft.goals[0];
    if (!primaryGoal) return;
    setSaving(true);
    setError("");

    const { error: saveError } = await createClient().rpc("complete_onboarding", {
      p_display_name: draft.displayName.trim(),
      p_default_session_minutes: draft.defaultMinutes,
      p_goals: draft.goals.map((name) => ({ name, is_primary: name === primaryGoal })),
    });

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    window.localStorage.removeItem("resurface-onboarding-draft");
    router.replace("/dashboard");
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center">Loading your profile…</main>;
  }

  return (
    <main className="flex min-h-screen flex-col px-5 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="flex items-center justify-between">
          <p className="text-lg font-semibold">
            Resurface<span className="text-[var(--accent)]">.AI</span>
          </p>
          <p className="text-sm text-[var(--muted)]">Step {step + 1} of 3</p>
        </header>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#dfe3da]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        <section className="mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
          {step === 0 && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Your profile</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">What should your saves help you do?</h1>
              <p className="mt-3 leading-7 text-[var(--muted)]">Choose up to three. This helps us tell useful from merely interesting.</p>

              <label className="mt-7 block text-sm font-medium" htmlFor="display-name">
                What should we call you?
                <input
                  autoComplete="name"
                  className="mt-2 min-h-12 w-full rounded-xl border border-[var(--border)] px-4 text-base"
                  id="display-name"
                  maxLength={60}
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                  placeholder="Your name"
                  value={draft.displayName}
                />
              </label>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {suggestedGoals.map((goal) => {
                  const selected = draft.goals.includes(goal);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`min-h-14 rounded-2xl border px-4 text-left font-medium transition ${selected ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)] hover:border-[var(--accent)]"}`}
                      key={goal}
                      onClick={() => toggleGoal(goal)}
                      type="button"
                    >
                      {selected ? "✓ " : "+ "}{goal}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex gap-2">
                <input
                  className="min-h-12 min-w-0 flex-1 rounded-xl border border-[var(--border)] px-4"
                  maxLength={40}
                  onChange={(event) => setCustomGoal(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addCustomGoal();
                    }
                  }}
                  placeholder="Add your own goal"
                  value={customGoal}
                />
                <button className="min-h-12 rounded-xl border border-[var(--border)] px-4 font-medium" onClick={addCustomGoal} type="button">Add</button>
              </div>
              <p className="mt-3 text-sm text-[var(--muted)]">{draft.goals.length} of 3 selected</p>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Your main focus</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">What matters most right now?</h1>
              <p className="mt-3 leading-7 text-[var(--muted)]">We will favor this when two saves compete. Your other goals will still appear.</p>
              <div className="mt-7 space-y-3">
                {draft.goals.map((goal) => {
                  const selected = draft.primaryGoal === goal;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`flex min-h-16 w-full items-center justify-between rounded-2xl border px-5 text-left font-medium transition ${selected ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)] hover:border-[var(--accent)]"}`}
                      key={goal}
                      onClick={() => setDraft({ ...draft, primaryGoal: goal })}
                      type="button"
                    >
                      {goal}<span aria-hidden="true">{selected ? "●" : "○"}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-5 text-sm text-[var(--muted)]">We will adapt as you complete, snooze, and archive.</p>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Your default session</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">How much time do you usually have?</h1>
              <p className="mt-3 leading-7 text-[var(--muted)]">This is only a starting point. You will confirm it every session.</p>
              <div className="mt-7 grid gap-3">
                {([
                  [5, "Quick reset"],
                  [10, "Balanced · recommended"],
                  [20, "Deep dive"],
                ] as const).map(([minutes, label]) => {
                  const selected = draft.defaultMinutes === minutes;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`flex min-h-16 items-center justify-between rounded-2xl border px-5 text-left transition ${selected ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)] hover:border-[var(--accent)]"}`}
                      key={minutes}
                      onClick={() => setDraft({ ...draft, defaultMinutes: minutes })}
                      type="button"
                    >
                      <span><strong>{minutes} minutes</strong><span className="ml-2 text-sm text-[var(--muted)]">{label}</span></span>
                      <span aria-hidden="true" className="text-[var(--accent)]">{selected ? "●" : "○"}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {error && <p aria-live="polite" className="mt-5 rounded-xl bg-[#fff0ec] px-4 py-3 text-sm text-[#8a3027]">{error}</p>}

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              className="min-h-12 px-3 font-medium text-[var(--muted)] disabled:invisible"
              disabled={step === 0}
              onClick={() => setStep(step === 2 && draft.goals.length === 1 ? 0 : step - 1)}
              type="button"
            >
              Back
            </button>
            {step === 0 && <PrimaryButton onClick={continueFromGoals}>Continue</PrimaryButton>}
            {step === 1 && <PrimaryButton disabled={!draft.primaryGoal} onClick={() => setStep(2)}>Continue</PrimaryButton>}
            {step === 2 && <PrimaryButton disabled={saving} onClick={finish}>{saving ? "Saving…" : "Finish setup"}</PrimaryButton>}
          </div>
        </section>
      </div>
    </main>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className="min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
