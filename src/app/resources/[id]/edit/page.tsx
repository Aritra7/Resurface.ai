"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { resourceContentTypes } from "@/features/resources/manual-schema";
import { CATEGORIES } from "@/lib/categorize";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";

type Goal = { id: string; name: string };
type Resource = {
  title: string | null;
  user_note: string | null;
  content_type: (typeof resourceContentTypes)[number];
  estimated_minutes: number;
  categories: string[];
  cognitive_effort: number | null;
  actionability: number | null;
  time_sensitivity: number | null;
  status: "active" | "completed" | "archived" | "snoozed" | "unreviewed";
  resource_goals: Array<{ goal_id: string; relevance: number }>;
};

export default function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const [resource, setResource] = useState<Resource | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (sessionLoading || !user) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [resourceResult, goalsResult] = await Promise.all([
        supabase.from("resources").select("title, user_note, content_type, estimated_minutes, categories, cognitive_effort, actionability, time_sensitivity, status, resource_goals(goal_id, relevance)").eq("id", id).eq("user_id", user.id).maybeSingle(),
        supabase.from("goals").select("id, name").eq("user_id", user.id).eq("active", true),
      ]);
      if (!active) return;
      if (resourceResult.error || goalsResult.error || !resourceResult.data) setMessage(resourceResult.error?.message ?? goalsResult.error?.message ?? "Resource not found.");
      else {
        const row = resourceResult.data as Resource;
        setResource({ ...row, cognitive_effort: row.cognitive_effort ?? 0.5, actionability: row.actionability ?? 0.5, time_sensitivity: row.time_sensitivity ?? 0.2 });
        setGoals((goalsResult.data as Goal[] | null) ?? []);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [id, sessionLoading, user]);

  function toggleCategory(category: string) {
    if (!resource) return;
    const selected = resource.categories ?? [];
    setResource({ ...resource, categories: selected.includes(category) ? selected.filter((item) => item !== category) : selected.length < 3 ? [...selected, category] : selected });
  }

  function toggleGoal(goalId: string) {
    if (!resource) return;
    const selected = resource.resource_goals.some((match) => match.goal_id === goalId);
    setResource({ ...resource, resource_goals: selected ? resource.resource_goals.filter((match) => match.goal_id !== goalId) : [...resource.resource_goals, { goal_id: goalId, relevance: 0.8 }] });
  }

  async function save() {
    if (!resource) return;
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/resources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: resource.title,
        userNote: resource.user_note ?? "",
        contentType: resource.content_type,
        estimatedMinutes: resource.estimated_minutes,
        categories: resource.categories,
        cognitiveEffort: Number(resource.cognitive_effort),
        actionability: Number(resource.actionability),
        timeSensitivity: Number(resource.time_sensitivity),
        status: ["completed", "archived"].includes(resource.status) ? resource.status : "active",
        goalMatches: resource.resource_goals.map((match) => ({ goalId: match.goal_id, relevance: match.relevance })),
      }),
    });
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (!response.ok) {
      setMessage(body?.error?.message ?? "The resource could not be updated.");
      setSaving(false);
      return;
    }
    router.push("/resources");
    router.refresh();
  }

  if (sessionLoading || loading) return <main className="flex min-h-screen items-center justify-center">Loading resource details…</main>;
  if (!resource) return <main className="flex min-h-screen items-center justify-center px-5"><section className="rounded-3xl bg-white p-8 text-center"><h1 className="text-2xl font-semibold">Resource unavailable</h1><p className="mt-3 text-[var(--muted)]">{message}</p><Link className="mt-5 inline-flex font-semibold text-[var(--accent)]" href="/resources">Back to resources</Link></section></main>;

  return <main className="min-h-screen px-5 py-8 pb-28 sm:px-8 md:pb-8"><div className="mx-auto max-w-3xl"><AppHeader current="resources" /><section className="mt-12 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-9"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Correct the optimizer’s inputs</p><h1 className="mt-3 text-3xl font-semibold">Edit resource</h1><p className="mt-3 text-[var(--muted)]">These values directly affect when and why this save resurfaces.</p>
    <div className="mt-8 grid gap-5">
      <Field label="Title"><input className="min-h-12 w-full rounded-2xl border border-[var(--border)] px-4" maxLength={500} onChange={(event) => setResource({ ...resource, title: event.target.value })} value={resource.title ?? ""} /></Field>
      <Field label="Your note"><textarea className="min-h-24 w-full rounded-2xl border border-[var(--border)] p-4" maxLength={500} onChange={(event) => setResource({ ...resource, user_note: event.target.value })} value={resource.user_note ?? ""} /></Field>
      <div className="grid gap-4 sm:grid-cols-3"><Field label="Type"><select className="min-h-12 w-full rounded-2xl border border-[var(--border)] bg-white px-3" onChange={(event) => setResource({ ...resource, content_type: event.target.value as Resource["content_type"] })} value={resource.content_type}>{resourceContentTypes.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}</select></Field><Field label="Minutes"><input className="min-h-12 w-full rounded-2xl border border-[var(--border)] px-3" max={240} min={1} onChange={(event) => setResource({ ...resource, estimated_minutes: Number(event.target.value) })} type="number" value={resource.estimated_minutes} /></Field><Field label="State"><select className="min-h-12 w-full rounded-2xl border border-[var(--border)] bg-white px-3" onChange={(event) => setResource({ ...resource, status: event.target.value as Resource["status"] })} value={["completed", "archived"].includes(resource.status) ? resource.status : "active"}><option value="active">Ready</option><option value="completed">Completed</option><option value="archived">Archived</option></select></Field></div>
      <Field label="Categories · choose up to three"><div className="flex flex-wrap gap-2">{CATEGORIES.map((category) => <button aria-pressed={resource.categories.includes(category)} className={`rounded-full border px-3 py-2 text-sm ${resource.categories.includes(category) ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`} key={category} onClick={() => toggleCategory(category)} type="button">{formatLabel(category)}</button>)}</div></Field>
      <Field label="Goals"><div className="flex flex-wrap gap-2">{goals.map((goal) => { const selected = resource.resource_goals.some((match) => match.goal_id === goal.id); return <button aria-pressed={selected} className={`rounded-full border px-3 py-2 text-sm ${selected ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`} key={goal.id} onClick={() => toggleGoal(goal.id)} type="button">{goal.name}</button>; })}</div></Field>
      <Signal label="Actionability" help="How directly can you use this?" onChange={(value) => setResource({ ...resource, actionability: value })} value={Number(resource.actionability)} />
      <Signal label="Time sensitivity" help="How quickly will this lose relevance?" onChange={(value) => setResource({ ...resource, time_sensitivity: value })} value={Number(resource.time_sensitivity)} />
      <Signal label="Cognitive effort" help="How much focus does this require?" onChange={(value) => setResource({ ...resource, cognitive_effort: value })} value={Number(resource.cognitive_effort)} />
    </div>
    {message && <p className="mt-5 rounded-2xl bg-[#fbeceb] p-4 text-sm text-[#7a302a]">{message}</p>}
    <div className="mt-8 flex flex-col gap-3 sm:flex-row"><button className="min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white disabled:opacity-60" disabled={saving} onClick={save} type="button">{saving ? "Saving…" : "Save changes"}</button><Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] px-6 font-semibold" href="/resources">Cancel</Link></div>
  </section></div></main>;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) { return <label><span className="mb-2 block text-sm font-semibold">{label}</span>{children}</label>; }
function Signal({ help, label, onChange, value }: { help: string; label: string; onChange: (value: number) => void; value: number }) { return <label><span className="flex justify-between gap-4"><span><strong className="block text-sm">{label}</strong><small className="text-[var(--muted)]">{help}</small></span><b className="text-[var(--accent)]">{Math.round(value * 100)}%</b></span><input className="mt-3 w-full accent-[var(--accent)]" max={1} min={0} onChange={(event) => onChange(Number(event.target.value))} step={0.05} type="range" value={value} /></label>; }
function formatLabel(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
