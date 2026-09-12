"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";

type Resource = { id: string; status: string; estimated_minutes: number; categories: string[] };
type Session = { id: string; time_budget_minutes: number; energy_mode: string; started_at: string; completed_at: string | null };
type SessionItem = { session_id: string; outcome: string | null; time_spent_seconds: number | null };

export default function ProgressPage() {
  const { user, loading: sessionLoading } = useSession();
  const [resources, setResources] = useState<Resource[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sessionLoading || !user) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [resourceResult, sessionResult, itemResult] = await Promise.all([
        supabase.from("resources").select("id, status, estimated_minutes, categories").eq("user_id", user.id).neq("status", "unavailable"),
        supabase.from("sessions").select("id, time_budget_minutes, energy_mode, started_at, completed_at").eq("user_id", user.id).order("started_at", { ascending: false }),
        supabase.from("session_items").select("session_id, outcome, time_spent_seconds"),
      ]);
      if (!active) return;
      const firstError = resourceResult.error ?? sessionResult.error ?? itemResult.error;
      if (firstError) setError(firstError.message);
      else {
        setResources((resourceResult.data as Resource[] | null) ?? []);
        setSessions((sessionResult.data as Session[] | null) ?? []);
        setItems((itemResult.data as SessionItem[] | null) ?? []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [sessionLoading, user]);

  const completed = resources.filter((resource) => resource.status === "completed");
  const trackable = resources.filter((resource) => ["active", "snoozed", "completed"].includes(resource.status));
  const eligibleTotal = trackable.length;
  const percent = eligibleTotal ? Math.round((completed.length / eligibleTotal) * 100) : 0;
  const completedSessions = sessions.filter((session) => session.completed_at);
  const trackedSeconds = items.reduce((sum, item) => sum + (item.time_spent_seconds ?? 0), 0);
  const estimatedMinutes = completed.reduce((sum, resource) => sum + resource.estimated_minutes, 0);
  const learnedMinutes = trackedSeconds > 0 ? Math.round(trackedSeconds / 60) : estimatedMinutes;
  const categoryProgress = useMemo(() => {
    const groups = new Map<string, { completed: number; total: number }>();
    for (const resource of resources.filter((entry) => ["active", "snoozed", "completed"].includes(entry.status))) {
      for (const category of resource.categories.length ? resource.categories : ["uncategorized"]) {
        const group = groups.get(category) ?? { completed: 0, total: 0 };
        group.total += 1;
        if (resource.status === "completed") group.completed += 1;
        groups.set(category, group);
      }
    }
    return [...groups.entries()].map(([name, value]) => ({ name, ...value, percent: Math.round((value.completed / value.total) * 100) })).sort((a, b) => b.total - a.total);
  }, [resources]);

  if (sessionLoading || loading) return <main className="flex min-h-screen items-center justify-center">Calculating your progress…</main>;

  return (
    <main className="min-h-screen px-5 py-8 pb-28 sm:px-8 md:pb-8"><div className="mx-auto max-w-5xl">
      <AppHeader current="progress" />
      {error ? <p className="mt-10 rounded-2xl bg-[#fbeceb] p-5 text-[#7a302a]">{error}</p> : <>
        <section className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[2rem] bg-[var(--accent)] p-7 text-white shadow-[0_24px_60px_rgba(47,111,78,0.2)]"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">Overall progress</p><h1 className="mt-2 text-4xl font-semibold">{percent}% revisited</h1><div className="mt-7 h-3 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-[#c8f0b3]" style={{ width: `${percent}%` }} /></div><p className="mt-4 text-sm text-white/75">{completed.length} of {eligibleTotal} available saves completed</p></article>
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-7"><p className="text-sm text-[var(--muted)]">Your activity</p><div className="mt-5 grid grid-cols-3 gap-3"><Stat value={String(completedSessions.length)} label="sessions" /><Stat value={`${learnedMinutes}m`} label="revisited" /><Stat value={String(Math.max(0, eligibleTotal - completed.length))} label="remaining" /></div><p className="mt-5 text-sm leading-6 text-[var(--muted)]">Time uses recorded activity when available and estimated duration otherwise.</p></article>
        </section>
        <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><div className="flex items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">Category progress</p><h2 className="mt-1 text-2xl font-semibold">Where your saves are becoming useful</h2></div><Link className="text-sm font-semibold text-[var(--accent)]" href="/session/new">Continue →</Link></div>{categoryProgress.length ? <div className="mt-6 space-y-5">{categoryProgress.map((category) => <div key={category.name}><div className="flex justify-between text-sm"><strong>{formatLabel(category.name)}</strong><span className="font-semibold text-[var(--accent)]">{category.percent}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${category.percent}%` }} /></div><p className="mt-2 text-xs text-[var(--muted)]">{category.completed} of {category.total} completed</p></div>)}</div> : <p className="mt-6 text-[var(--muted)]">Complete a categorized resource to start seeing progress.</p>}</section>
        <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><p className="text-sm text-[var(--muted)]">Recent sessions</p><h2 className="mt-1 text-2xl font-semibold">Your resurfacing history</h2>{sessions.length ? <div className="mt-5 divide-y divide-[var(--border)]">{sessions.slice(0, 8).map((session) => <div className="flex items-center justify-between gap-4 py-4" key={session.id}><div><strong>{session.time_budget_minutes}-minute {session.energy_mode} session</strong><p className="mt-1 text-xs text-[var(--muted)]">{new Date(session.started_at).toLocaleDateString()}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${session.completed_at ? "bg-[#e9f3e5] text-[var(--accent)]" : "bg-[#fff0c9] text-[#7d5b17]"}`}>{session.completed_at ? "Complete" : "In progress"}</span></div>)}</div> : <p className="mt-5 text-[var(--muted)]">Your first session will appear here.</p>}</section>
      </>}
    </div></main>
  );
}

function Stat({ value, label }: { value: string; label: string }) { return <div className="rounded-2xl bg-[#f2f4ee] p-3"><strong className="block text-2xl text-[var(--accent)]">{value}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{label}</span></div>; }
function formatLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
