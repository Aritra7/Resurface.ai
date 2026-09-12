"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createDemoResources } from "@/features/recommendations/demo-fixtures";
import { listStoredSessions, type StoredSession } from "@/features/sessions/local-session-store";

export default function ProgressPage() {
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
  const minutes = sessions.reduce((sum, session) => sum + session.items.filter((item) => session.outcomes[item.resource.id] === "completed").reduce((total, item) => total + item.resource.estimatedMinutes, 0), 0);
  const percent = resources.length ? Math.round((completed / resources.length) * 100) : 0;
  const topics = [...new Set(resources.map((resource) => resource.topic ?? "Other"))].map((topic) => {
    const items = resources.filter((resource) => (resource.topic ?? "Other") === topic);
    const done = items.filter((item) => sessions.some((session) => session.outcomes[item.id] === "completed")).length;
    return { topic, done, total: items.length, percent: Math.round((done / items.length) * 100) };
  });

  return <main className="min-h-screen bg-[#f5f6ef] px-5 py-6 sm:px-8"><div className="mx-auto max-w-5xl">
    <Header active="progress" />
    <section className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"><article className="rounded-[2rem] bg-[var(--accent)] p-7 text-white shadow-[0_24px_60px_rgba(47,111,78,0.2)]"><div className="flex items-end justify-between"><div><p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">Overall progress</p><h2 className="mt-2 text-4xl font-semibold">{percent}% complete</h2></div><span className="text-5xl">✦</span></div><div className="mt-7 h-3 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-[#c8f0b3]" style={{ width: `${percent}%` }} /></div><p className="mt-4 text-sm text-white/75">{completed} of {resources.length} learning actions complete</p></article><article className="rounded-[2rem] border border-[var(--border)] bg-white p-7"><p className="text-sm font-medium text-[var(--muted)]">Your stats</p><div className="mt-5 grid grid-cols-3 gap-3"><ProgressStat value={String(sessions.length)} label="sessions" /><ProgressStat value={`${minutes}m`} label="learned" /><ProgressStat value={String(resources.length - completed)} label="to go" /></div><p className="mt-5 text-sm leading-6 text-[var(--muted)]">Every completed save moves the path forward. Partial sessions stay available to resume.</p></article></section>
    <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><div className="flex items-end justify-between"><div><p className="text-sm font-medium text-[var(--muted)]">Topic growth</p><h2 className="mt-1 text-2xl font-semibold">Where you are growing</h2></div><span className="text-sm text-[var(--muted)]">Live from your saves</span></div><div className="mt-6 space-y-5">{topics.map((item) => <div key={item.topic}><div className="flex justify-between gap-3 text-sm"><strong>{item.topic}</strong><span className="font-semibold text-[var(--accent)]">{item.percent}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${item.percent}%` }} /></div><p className="mt-2 text-xs text-[var(--muted)]">{item.done} / {item.total} actions complete · {item.total - item.done} remaining</p></div>)}</div></section>
    <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8"><div className="flex items-center justify-between"><div><p className="text-sm font-medium text-[var(--muted)]">Recent sessions</p><h2 className="mt-1 text-2xl font-semibold">Keep the streak alive.</h2></div><Link className="text-sm font-semibold text-[var(--accent)]" href="/session/new">Start next →</Link></div>{sessions.length ? <div className="mt-5 divide-y divide-[var(--border)]">{sessions.slice(0, 5).map((session) => <div className="flex items-center justify-between gap-4 py-4 first:pt-0" key={session.id}><div><strong>{session.timeBudgetMinutes}-minute {session.energyMode} session</strong><p className="mt-1 text-xs text-[var(--muted)]">{session.items.filter((item) => session.outcomes[item.resource.id] === "completed").length} actions completed</p></div><span className="rounded-full bg-[#e9f3e5] px-3 py-1 text-xs font-semibold text-[var(--accent)]">{session.items.every((item) => session.outcomes[item.resource.id]) ? "Complete" : "In progress"}</span></div>)}</div> : <p className="mt-5 text-sm text-[var(--muted)]">Your first session will appear here.</p>}</section>
  </div></main>;
}

function Header({ active }: { active: string }) {
  return <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-5"><Link className="text-lg font-semibold tracking-tight" href="/">Resurface<span className="text-[var(--accent)]">.AI</span></Link><nav className="flex flex-wrap items-center gap-2 text-sm font-semibold"><Link className={active === "dashboard" ? "rounded-full bg-[#e9f3e5] px-3 py-2 text-[var(--accent)]" : "rounded-full px-3 py-2 text-[var(--muted)]"} href="/dashboard">Dashboard</Link><Link className={active === "path" ? "rounded-full bg-[#e9f3e5] px-3 py-2 text-[var(--accent)]" : "rounded-full px-3 py-2 text-[var(--muted)]"} href="/path">My Path</Link><Link className={active === "progress" ? "rounded-full bg-[#e9f3e5] px-3 py-2 text-[var(--accent)]" : "rounded-full px-3 py-2 text-[var(--muted)]"} href="/progress">Progress</Link><Link className={active === "resources" ? "rounded-full bg-[#e9f3e5] px-3 py-2 text-[var(--accent)]" : "rounded-full px-3 py-2 text-[var(--muted)]"} href="/resources">Resources</Link></nav></div><Link className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/session/new">Build my session</Link></header>;
}

function ProgressStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-[#f2f4ee] p-3"><strong className="block text-2xl font-semibold text-[var(--accent)]">{value}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{label}</span></div>;
}
