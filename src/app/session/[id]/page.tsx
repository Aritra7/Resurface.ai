"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  loadStoredSession,
  saveStoredSession,
  type SessionOutcome,
  type StoredSession,
} from "@/features/sessions/local-session-store";
import { createClient } from "@/lib/supabase/client";

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [warning, setWarning] = useState("");
  const [itemStartedAt, setItemStartedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    async function load() {
      await Promise.resolve();
      if (!active) return;
      const stored = loadStoredSession(id);
      setSession(stored);
      if (stored) {
        const firstUnanswered = stored.items.findIndex((item) => !stored.outcomes[item.resource.id]);
        const resumeAt = stored.currentIndex ?? firstUnanswered;
        setCurrentIndex(resumeAt < 0 ? Math.max(0, stored.items.length - 1) : resumeAt);
      }
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [id]);

  async function chooseOutcome(outcome: SessionOutcome) {
    if (!session) return;
    const item = session.items[currentIndex];
    const timeSpentSeconds = Math.max(0, Math.round((Date.now() - itemStartedAt) / 1_000));
    const snoozedUntil = outcome === "snoozed"
      ? new Date(Date.now() + 3 * 86_400_000).toISOString()
      : null;

    setPending(true);
    setWarning("");

    if (session.persisted) {
      const { error } = await createClient().rpc("record_resource_outcome", {
        p_session_id: session.id,
        p_resource_id: item.resource.id,
        p_outcome: outcome,
        p_snoozed_until: snoozedUntil,
        p_time_spent_seconds: timeSpentSeconds,
      });
      if (error) setWarning("Your choice is saved on this device, but Supabase could not record it yet.");
    }

    const nextOutcomes = { ...session.outcomes, [item.resource.id]: outcome };
    const nextIndex = session.items.findIndex(
      (candidate, index) => index > currentIndex && !nextOutcomes[candidate.resource.id],
    );
    const fallbackIndex = session.items.findIndex(
      (candidate) => !nextOutcomes[candidate.resource.id],
    );
    const allAnswered = Object.keys(nextOutcomes).length >= session.items.length;
    const updated = {
      ...session,
      outcomes: nextOutcomes,
      currentIndex: allAnswered
        ? currentIndex
        : nextIndex >= 0
          ? nextIndex
          : fallbackIndex,
    };
    saveStoredSession(updated);
    setSession(updated);

    if (allAnswered && session.persisted) {
      await createClient().rpc("finish_recommendation_session", { p_session_id: session.id });
    }

    if (!allAnswered) setCurrentIndex(updated.currentIndex);
    setItemStartedAt(Date.now());
    setPending(false);
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center">Opening your session…</main>;
  }

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <section className="max-w-lg rounded-[2rem] border border-[var(--border)] bg-white p-8 text-center">
          <h1 className="text-2xl font-semibold">This session is not available on this device.</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">Build a new queue to keep resurfacing your saves.</p>
          <Link className="mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href="/session/new">Build a session</Link>
        </section>
      </main>
    );
  }

  const complete = session.items.every((item) => Boolean(session.outcomes[item.resource.id]));
  if (complete) return <SessionSummary session={session} warning={warning} />;

  const current = session.items[currentIndex];
  const progress = (Object.keys(session.outcomes).length / session.items.length) * 100;

  function moveTo(index: number) {
    if (!session) return;
    const bounded = Math.max(0, Math.min(index, session.items.length - 1));
    setCurrentIndex(bounded);
    saveStoredSession({ ...session, currentIndex: bounded });
    setItemStartedAt(Date.now());
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between gap-4">
          <Link className="text-lg font-semibold" href="/dashboard">Resurface<span className="text-[var(--accent)]">.AI</span></Link>
          <p className="text-sm text-[var(--muted)]">{currentIndex + 1} of {session.items.length}</p>
        </header>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#dfe3da]">
          <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${progress}%` }} />
        </div>

        <section className="mt-10 rounded-[2rem] border border-[var(--border)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
          <div className="mb-6 flex items-center justify-between gap-3">
            <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={currentIndex === 0} onClick={() => moveTo(currentIndex - 1)} type="button">← Previous</button>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Navigate session</span>
            <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-40" disabled={currentIndex === session.items.length - 1} onClick={() => moveTo(currentIndex + 1)} type="button">Next →</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-[#edf0e8] px-3 py-1 font-medium capitalize">{current.resource.source}</span>
            <span className="text-[var(--muted)]">{current.resource.estimatedMinutes} min · {formatContentType(current.resource.contentType)}</span>
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-5xl">{current.resource.title}</h1>

          <div className="mt-7 rounded-2xl bg-[#f2f4ee] p-5">
            <p className="text-sm font-semibold">Why this is here</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
              {current.explanations.map((explanation) => <li key={explanation}>• {explanation}</li>)}
            </ul>
          </div>

          <a
            className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white"
            href={current.resource.url}
            rel="noreferrer"
            target="_blank"
          >
            Open resource
          </a>

          <div className="mt-8 border-t border-[var(--border)] pt-6">
            <p className="text-center text-sm font-medium text-[var(--muted)]">What should happen to this save?</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <OutcomeButton disabled={pending} label="Completed" onClick={() => chooseOutcome("completed")} />
              <OutcomeButton disabled={pending} label="Snooze 3 days" onClick={() => chooseOutcome("snoozed")} />
              <OutcomeButton disabled={pending} label="Archive" onClick={() => chooseOutcome("archived")} />
            </div>
            <button className="mt-4 w-full text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]" disabled={pending} onClick={() => chooseOutcome("skipped")} type="button">Skip and let the next session reconsider it</button>
          </div>
          {warning && <p className="mt-5 rounded-xl bg-[#fff4db] px-4 py-3 text-sm">{warning}</p>}
        </section>
      </div>
    </main>
  );
}

function OutcomeButton({ disabled, label, onClick }: { disabled: boolean; label: string; onClick: () => void }) {
  return (
    <button className="min-h-12 rounded-full border border-[var(--border)] px-4 font-semibold hover:border-[var(--accent)] disabled:opacity-50" disabled={disabled} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function SessionSummary({ session, warning }: { session: StoredSession; warning: string }) {
  const counts = Object.values(session.outcomes).reduce<Record<string, number>>((result, outcome) => {
    result[outcome] = (result[outcome] ?? 0) + 1;
    return result;
  }, {});

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-2xl rounded-[2rem] border border-[var(--border)] bg-white p-7 text-center shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Session complete</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">You resurfaced {session.items.length} saves.</h1>
        <p className="mt-3 text-[var(--muted)]">A finite session, finished in about {session.totalMinutes} minutes.</p>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat label="Completed" value={counts.completed ?? 0} />
          <SummaryStat label="Snoozed" value={counts.snoozed ?? 0} />
          <SummaryStat label="Archived" value={counts.archived ?? 0} />
          <SummaryStat label="Skipped" value={counts.skipped ?? 0} />
        </div>
        {warning && <p className="mt-5 rounded-xl bg-[#fff4db] px-4 py-3 text-sm">{warning}</p>}
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href="/dashboard">Back to dashboard</Link>
          <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] px-6 font-semibold" href="/session/new">Build another</Link>
        </div>
      </section>
    </main>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-[#f2f4ee] p-4"><p className="text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{label}</p></div>;
}

function formatContentType(contentType: string): string {
  return contentType.replaceAll("_", " ");
}
