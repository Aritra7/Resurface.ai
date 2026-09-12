"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createDemoResources } from "@/features/recommendations/demo-fixtures";
import { listStoredSessions, type StoredSession } from "@/features/sessions/local-session-store";

export default function PathPage() {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const resources = useMemo(() => createDemoResources(new Date().toISOString()), []);
  useEffect(() => {
    const refresh = () => setSessions(listStoredSessions());
    refresh();
    window.addEventListener("resurface:state-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("resurface:state-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  const completed = resources.filter((resource) => sessions.some((session) => session.outcomes[resource.id] === "completed")).length;
  const percent = Math.round((completed / Math.max(resources.length, 1)) * 100);
  const stages = [
    { name: "Understand", detail: "Build the foundation", threshold: 0 },
    { name: "Practice", detail: "Apply what you saved", threshold: 25 },
    { name: "Build momentum", detail: "Return and reinforce", threshold: 50 },
    { name: "Mastery", detail: "Learn independently", threshold: 75 },
  ];
  const currentStage = [...stages].reverse().find((stage) => percent >= stage.threshold) ?? stages[0];
  const next = resources.find((resource) => !sessions.some((session) => session.outcomes[resource.id] === "completed"));
  const groups = [...new Set(resources.map((resource) => resource.section ?? "Explore your saves"))];

  return <main className="min-h-screen bg-[#f5f6ef] px-5 py-6 sm:px-8"><div className="mx-auto max-w-5xl">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-5"><Link className="text-lg font-semibold tracking-tight" href="/">Resurface<span className="text-[var(--accent)]">.AI</span></Link><nav className="flex flex-wrap items-center gap-2 text-sm font-semibold"><Link className="rounded-full px-3 py-2 text-[var(--muted)]" href="/dashboard">Dashboard</Link><Link className="rounded-full bg-[#e9f3e5] px-3 py-2 text-[var(--accent)]" href="/path">My Path</Link><Link className="rounded-full px-3 py-2 text-[var(--muted)]" href="/progress">Progress</Link><Link className="rounded-full px-3 py-2 text-[var(--muted)]" href="/resources">Resources</Link></nav></div><Link className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/session/new">Build my session</Link></header>
    <section className="mt-10 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><div className="flex items-center justify-between"><div><p className="text-sm font-medium text-[var(--muted)]">Current stage</p><h2 className="mt-1 text-2xl font-semibold">{currentStage.name}</h2></div><span className="text-sm text-[var(--muted)]">{currentStage.detail}</span></div><div className="mt-7 grid gap-3 sm:grid-cols-4">{stages.map((stage) => <div className={`rounded-2xl border p-4 ${stage.name === currentStage.name ? "border-[var(--accent)] bg-[#e9f3e5]" : percent >= stage.threshold ? "border-[#b9dcae]" : "border-[var(--border)]"}`} key={stage.name}><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-[var(--accent)]">{percent >= stage.threshold ? "✓" : "○"}</span><strong className="mt-3 block text-sm">{stage.name}</strong><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{stage.detail}</span></div>)}</div></section>
    {next && <section className="mt-6 rounded-[2rem] bg-[var(--accent)] p-7 text-white shadow-[0_24px_60px_rgba(47,111,78,0.2)]"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">Up next</p><h2 className="mt-2 text-3xl font-semibold">{next.title}</h2><p className="mt-2 text-white/75">{next.estimatedMinutes} minutes · {next.section ?? "Next learning action"}</p><p className="mt-4 max-w-xl text-sm leading-6 text-white/80">This is the next unfinished step in your path. Complete it to move your journey forward.</p><Link className="mt-6 inline-flex rounded-full bg-white px-5 py-3 font-semibold text-[var(--accent)]" href="/session/new">Build this session →</Link></section>}
    <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><p className="text-sm font-medium text-[var(--muted)]">Path sections</p><h2 className="mt-1 text-2xl font-semibold">Your journey at a glance.</h2><div className="mt-6 space-y-3">{groups.map((group, index) => { const items = resources.filter((resource) => (resource.section ?? "Explore your saves") === group); const done = items.filter((item) => sessions.some((session) => session.outcomes[item.id] === "completed")).length; return <div className="flex items-center gap-4 rounded-2xl border border-[var(--border)] p-4" key={group}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edf0e8] font-bold text-[var(--accent)]">0{index + 1}</span><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><strong>{group}</strong><span className="text-sm font-semibold text-[var(--accent)]">{done}/{items.length}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.round((done / items.length) * 100)}%` }} /></div></div></div>; })}</div></section>
  </div></main>;
}
