"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";

type Goal = { id: string; name: string; is_primary: boolean };
type Resource = { id: string; title: string | null; url: string; status: string; estimated_minutes: number; resource_goals: Array<{ goal_id: string; relevance: number }> };

export default function PathPage() {
  const { user, loading: sessionLoading } = useSession();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sessionLoading || !user) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [goalResult, resourceResult] = await Promise.all([
        supabase.from("goals").select("id, name, is_primary").eq("user_id", user.id).eq("active", true).order("is_primary", { ascending: false }),
        supabase.from("resources").select("id, title, url, status, estimated_minutes, resource_goals(goal_id, relevance)").eq("user_id", user.id).not("status", "in", "(archived,unavailable)").order("saved_at", { ascending: true }),
      ]);
      if (!active) return;
      const firstError = goalResult.error ?? resourceResult.error;
      if (firstError) setError(firstError.message);
      else {
        setGoals((goalResult.data as Goal[] | null) ?? []);
        setResources((resourceResult.data as Resource[] | null) ?? []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [sessionLoading, user]);

  const paths = useMemo(() => goals.map((goal) => {
    const items = resources.filter((resource) => resource.resource_goals.some((match) => match.goal_id === goal.id));
    const completed = items.filter((item) => item.status === "completed").length;
    const remaining = items.filter((item) => item.status !== "completed");
    return { ...goal, items, completed, remaining, percent: items.length ? Math.round((completed / items.length) * 100) : 0 };
  }), [goals, resources]);
  const primaryPath = paths.find((path) => path.is_primary) ?? paths[0];
  const next = primaryPath?.remaining.find((item) => item.status === "active") ?? primaryPath?.remaining[0];

  if (sessionLoading || loading) return <main className="flex min-h-screen items-center justify-center">Building your path…</main>;

  return (
    <main className="min-h-screen px-5 py-8 pb-28 sm:px-8 md:pb-8"><div className="mx-auto max-w-5xl">
      <AppHeader current="path" />
      {error ? <p className="mt-10 rounded-2xl bg-[#fbeceb] p-5 text-[#7a302a]">{error}</p> : <>
        <section className="mt-12"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">My path</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Your goals, turned into visible progress.</h1><p className="mt-4 max-w-2xl text-[var(--muted)]">Each path is built from resources actually linked to that goal. Completing, snoozing, or archiving a save updates the journey.</p></section>
        {next && <section className="mt-8 rounded-[2rem] bg-[var(--accent)] p-7 text-white shadow-[0_24px_60px_rgba(47,111,78,0.2)]"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">Up next for {primaryPath.name}</p><h2 className="mt-2 text-3xl font-semibold">{next.title?.trim() || "Untitled save"}</h2><p className="mt-3 text-white/75">{next.estimated_minutes} minutes · next unfinished resource in your main goal</p><Link className="mt-6 inline-flex rounded-full bg-white px-5 py-3 font-semibold text-[var(--accent)]" href={`/session/new?goal=${primaryPath.id}`}>Build a focused session →</Link></section>}
        <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><div><p className="text-sm text-[var(--muted)]">Active goal paths</p><h2 className="mt-1 text-2xl font-semibold">Choose where to build momentum</h2></div>{paths.length ? <div className="mt-6 space-y-4">{paths.map((path, index) => <article className={`rounded-2xl border p-5 ${path.is_primary ? "border-[var(--accent)] bg-[#f3faef]" : "border-[var(--border)]"}`} key={path.id}><div className="flex items-center gap-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white font-bold text-[var(--accent)]">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><strong>{path.name}{path.is_primary ? " · Main focus" : ""}</strong><span className="text-sm font-semibold text-[var(--accent)]">{path.percent}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${path.percent}%` }} /></div><p className="mt-2 text-xs text-[var(--muted)]">{path.completed} completed · {path.remaining.length} remaining · {path.items.length} linked saves</p></div><Link className="shrink-0 text-sm font-semibold text-[var(--accent)]" href={`/session/new?goal=${path.id}`}>Focus →</Link></div></article>)}</div> : <div className="mt-6 rounded-2xl border border-dashed border-[var(--border)] p-6"><p className="text-[var(--muted)]">No active goals are available yet.</p><Link className="mt-3 inline-flex font-semibold text-[var(--accent)]" href="/onboarding">Set your goals →</Link></div>}</section>
      </>}
    </div></main>
  );
}
