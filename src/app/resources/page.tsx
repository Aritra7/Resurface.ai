"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createDemoResources } from "@/features/recommendations/demo-fixtures";
import { createClient } from "@/lib/supabase/client";
import type { RecommendationResource } from "@/features/recommendations";
import { listStoredSessions, type StoredSession } from "@/features/sessions/local-session-store";

type ResourceView = RecommendationResource & {
  topic: string;
  displayStatus?: "completed" | "in_progress" | "not_started";
};

export default function ResourcesPage() {
  const [resources, setResources] = useState<ResourceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingSamples, setUsingSamples] = useState(false);
  const [localSessions, setLocalSessions] = useState<StoredSession[]>([]);

  useEffect(() => {
    async function loadResources() {
      const now = new Date().toISOString();
      setLocalSessions(listStoredSessions());
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setResources(createDemoResources(now).map(toViewResource));
        setUsingSamples(true);
        setLoading(false);
        return;
      }

      const [goalsResult, resourcesResult] = await Promise.all([
        supabase.from("goals").select("id, name").eq("user_id", authData.user.id).eq("active", true),
        supabase.from("resources").select("id, url, source, content_type, title, estimated_minutes, cognitive_effort, actionability, time_sensitivity, time_sensitivity_reason, saved_at, published_at, relevant_until, status, snoozed_until, resource_goals(goal_id, relevance)").eq("user_id", authData.user.id).not("status", "in", "(archived,unavailable)").order("saved_at", { ascending: false }),
      ]);

      if (resourcesResult.error || !resourcesResult.data?.length) {
        setResources(createDemoResources(now).map(toViewResource));
        setUsingSamples(true);
      } else {
        const goals = new Map((goalsResult.data ?? []).map((goal) => [goal.id, goal.name]));
        setResources((resourcesResult.data as unknown as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id),
          url: String(row.url),
          source: String(row.source),
          contentType: String(row.content_type),
          title: String(row.title ?? "Untitled save"),
          estimatedMinutes: Number(row.estimated_minutes ?? 0),
          cognitiveEffort: row.cognitive_effort as number | null,
          actionability: row.actionability as number | null,
          timeSensitivity: row.time_sensitivity as number | null,
          timeSensitivityReason: row.time_sensitivity_reason as string | null,
          savedAt: String(row.saved_at),
          publishedAt: row.published_at as string | null,
          relevantUntil: row.relevant_until as string | null,
          status: row.status as RecommendationResource["status"],
          snoozedUntil: row.snoozed_until as string | null,
          goalMatches: [],
          topic: "resource_goals" in row && Array.isArray(row.resource_goals)
            ? (row.resource_goals as Array<{ goal_id: string }>).map((match) => goals.get(match.goal_id)).find(Boolean) ?? "Unassigned topic"
            : "Unassigned topic",
        })));
      }
      setLoading(false);
    }
    loadResources();
    const refresh = () => setLocalSessions(listStoredSessions());
    window.addEventListener("resurface:state-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("resurface:state-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const effectiveResources = useMemo(() => {
    const completed = new Set<string>();
    const inProgress = new Set<string>();
    for (const session of localSessions) {
      for (const [resourceId, outcome] of Object.entries(session.outcomes)) {
          if (outcome === "completed") completed.add(resourceId);
      }
      if (!session.items.every((item) => session.outcomes[item.resource.id])) {
        for (const item of session.items) {
          if (!session.outcomes[item.resource.id]) inProgress.add(item.resource.id);
        }
      }
    }
    return resources.map((resource): ResourceView => ({
      ...resource,
      displayStatus: resource.status === "completed" || completed.has(resource.id) ? "completed" : inProgress.has(resource.id) ? "in_progress" : "not_started",
    }));
  }, [localSessions, resources]);

  const topics = useMemo(() => {
    const grouped = new Map<string, ResourceView[]>();
    for (const resource of effectiveResources) grouped.set(resource.topic, [...(grouped.get(resource.topic) ?? []), resource]);
    return [...grouped.entries()];
  }, [effectiveResources]);

  return (
    <main className="min-h-screen bg-[#f5f6ef] px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-5">
            <Link className="text-lg font-semibold tracking-tight" href="/">Resurface<span className="text-[var(--accent)]">.AI</span></Link>
            <nav className="flex items-center gap-3 text-sm font-semibold">
              <Link className="rounded-full bg-[#e9f3e5] px-4 py-2 text-[var(--accent)]" href="/dashboard">Dashboard</Link>
              <Link className="rounded-full border border-[var(--border)] bg-white px-4 py-2" href="/resources">Resources</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3"><Link className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold" href="/dashboard">Dashboard</Link><Link className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/session/new">Build my session</Link></div>
        </header>

        <section className="mt-12">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">{usingSamples ? "Sample resource library" : "Your resource library"}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Everything you saved, organized by topic.</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">Browse the source material behind your learning path. Each save shows its topic, source type, duration, and current state.</p>
        </section>

        {loading ? <p className="mt-10 text-[var(--muted)]">Loading your resources…</p> : (
          <div className="mt-10 space-y-8">
            {topics.map(([topic, items]) => (
              <section className="rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8" key={topic}>
                <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-[var(--muted)]">Learning topic</p><h2 className="mt-1 text-2xl font-semibold">{topic}</h2></div><span className="text-sm text-[var(--muted)]">{items.length} resources</span></div>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {items.map((resource) => <article className={`rounded-2xl border p-4 ${resource.displayStatus === "completed" ? "border-[#b9dcae] bg-[#f3faef]" : resource.displayStatus === "in_progress" ? "border-[#e7cb8c] bg-[#fffaf0]" : "border-[var(--border)] bg-white"}`} key={resource.id}><div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"><span>{formatType(resource.contentType)}</span><span>{resource.estimatedMinutes} min</span></div><h3 className="mt-3 font-semibold">{resource.title}</h3><div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]"><span className="rounded-full bg-white/80 px-2.5 py-1">{formatSource(resource.source)}</span><StatusBadge status={resource.displayStatus ?? "not_started"} /></div><a className="mt-4 inline-flex text-sm font-semibold text-[var(--accent)]" href={resource.url} rel="noreferrer" target="_blank">{resource.displayStatus === "completed" ? "Review resource →" : resource.displayStatus === "in_progress" ? "Continue path →" : "Open resource →"}</a></article>)}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function toViewResource(resource: RecommendationResource): ResourceView {
  return { ...resource, topic: resource.topic ?? resource.section ?? "Unassigned topic" };
}

function formatType(type: string) {
  return type.replaceAll("_", " ");
}

function formatSource(source: string) {
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function StatusBadge({ status }: { status: "completed" | "in_progress" | "not_started" }) {
  const labels = { completed: "Completed", in_progress: "In progress", not_started: "Not started" };
  const styles = { completed: "bg-[#dff1d8] text-[var(--accent)]", in_progress: "bg-[#ffedc2] text-[#8a641c]", not_started: "bg-[#f2f4ee] text-[var(--muted)]" };
  return <span className={`rounded-full px-2.5 py-1 ${styles[status]}`}>{labels[status]}</span>;
}
