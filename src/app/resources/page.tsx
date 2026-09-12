"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";

type ResourceStatus = "unreviewed" | "active" | "snoozed" | "completed" | "archived" | "unavailable";

type ResourceRow = {
  id: string;
  url: string;
  title: string | null;
  source: string;
  content_type: string;
  categories: string[];
  estimated_minutes: number;
  status: ResourceStatus;
  saved_at: string;
  enrichment_status: string;
  resource_goals: Array<{ goal_id: string }>;
};

type Goal = { id: string; name: string };

const STATUS_OPTIONS: Array<{ value: "all" | ResourceStatus; label: string }> = [
  { value: "all", label: "All states" },
  { value: "active", label: "Ready" },
  { value: "snoozed", label: "Snoozed" },
  { value: "completed", label: "Completed" },
  { value: "unreviewed", label: "Needs review" },
  { value: "archived", label: "Archived" },
];

export default function ResourcesPage() {
  const { user, loading: sessionLoading } = useSession();
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | ResourceStatus>("all");

  useEffect(() => {
    if (sessionLoading) return;
    if (!user) return;
    let active = true;

    void (async () => {
      const supabase = createClient();
      const [resourcesResult, goalsResult] = await Promise.all([
        supabase
          .from("resources")
          .select("id, url, title, source, content_type, categories, estimated_minutes, status, saved_at, enrichment_status, resource_goals(goal_id)")
          .eq("user_id", user.id)
          .neq("status", "unavailable")
          .order("saved_at", { ascending: false }),
        supabase.from("goals").select("id, name").eq("user_id", user.id).eq("active", true),
      ]);

      if (!active) return;
      if (resourcesResult.error || goalsResult.error) {
        setError(resourcesResult.error?.message ?? goalsResult.error?.message ?? "Your resources could not be loaded.");
      } else {
        setResources((resourcesResult.data as ResourceRow[] | null) ?? []);
        setGoals((goalsResult.data as Goal[] | null) ?? []);
      }
      setLoading(false);
    })();

    return () => { active = false; };
  }, [sessionLoading, user]);

  const goalNames = useMemo(() => new Map(goals.map((goal) => [goal.id, goal.name])), [goals]);
  const categories = useMemo(
    () => [...new Set(resources.flatMap((resource) => resource.categories ?? []))].sort(),
    [resources],
  );
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resources.filter((resource) => {
      if (status !== "all" && resource.status !== status) return false;
      if (category !== "all" && !resource.categories?.includes(category)) return false;
      if (!normalizedQuery) return true;
      const goalsForResource = resource.resource_goals.map((match) => goalNames.get(match.goal_id) ?? "");
      return [resource.title, resource.source, resource.content_type, ...resource.categories, ...goalsForResource]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [category, goalNames, query, resources, status]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ResourceRow[]>();
    for (const resource of filtered) {
      const label = resource.categories?.[0]
        ? formatLabel(resource.categories[0])
        : resource.resource_goals.map((match) => goalNames.get(match.goal_id)).find(Boolean) ?? "Uncategorized";
      groups.set(label, [...(groups.get(label) ?? []), resource]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, goalNames]);

  if (sessionLoading || loading) return <main className="flex min-h-screen items-center justify-center">Loading your resource library…</main>;

  return (
    <main className="min-h-screen px-5 py-8 pb-28 sm:px-8 md:pb-8">
      <div className="mx-auto max-w-6xl">
        <AppHeader current="resources" />
        <section className="mt-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Your resource library</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Everything you saved, ready to resurface.</h1>
            <p className="mt-4 max-w-2xl text-[var(--muted)]">Browse real saves by category, goal, and state. The optimizer draws its sessions from this library.</p>
          </div>
          <Link className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href="/add">Add resources</Link>
        </section>

        <section className="mt-8 grid gap-3 rounded-[2rem] border border-[var(--border)] bg-white p-5 md:grid-cols-[1fr_auto_auto]">
          <label className="sr-only" htmlFor="resource-search">Search resources</label>
          <input className="min-h-12 rounded-2xl border border-[var(--border)] px-4" id="resource-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, sources, categories, or goals" value={query} />
          <select aria-label="Filter by category" className="min-h-12 rounded-2xl border border-[var(--border)] bg-white px-4" onChange={(event) => setCategory(event.target.value)} value={category}>
            <option value="all">All categories</option>
            {categories.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
          </select>
          <select aria-label="Filter by state" className="min-h-12 rounded-2xl border border-[var(--border)] bg-white px-4" onChange={(event) => setStatus(event.target.value as "all" | ResourceStatus)} value={status}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </section>

        {error ? (
          <p className="mt-8 rounded-2xl bg-[#fbeceb] p-5 text-[#7a302a]">{error}</p>
        ) : grouped.length === 0 ? (
          <section className="mt-8 rounded-[2rem] border border-dashed border-[var(--border)] bg-white p-10 text-center">
            <h2 className="text-2xl font-semibold">No matching saves yet.</h2>
            <p className="mt-3 text-[var(--muted)]">Change the filters or add your first resource.</p>
          </section>
        ) : (
          <div className="mt-8 space-y-7">
            {grouped.map(([label, items]) => (
              <section className="rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-8" key={label}>
                <div className="flex items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">Category</p><h2 className="mt-1 text-2xl font-semibold">{label}</h2></div><span className="text-sm text-[var(--muted)]">{items.length} {items.length === 1 ? "save" : "saves"}</span></div>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {items.map((resource) => (
                    <article className="rounded-2xl border border-[var(--border)] p-5" key={resource.id}>
                      <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]"><span>{formatLabel(resource.source)} · {formatLabel(resource.content_type)}</span><span>{resource.estimated_minutes} min</span></div>
                      <h3 className="mt-3 font-semibold leading-6">{resource.title?.trim() || "Untitled save"}</h3>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <StatusBadge status={resource.status} />
                        {resource.enrichment_status === "failed" && <span className="rounded-full bg-[#fbeceb] px-2.5 py-1 text-xs font-semibold text-[#8a3a33]">Needs details</span>}
                        {resource.resource_goals.map((match) => goalNames.get(match.goal_id)).filter(Boolean).map((goal) => <span className="rounded-full bg-[#edf0e8] px-2.5 py-1 text-xs" key={goal}>{goal}</span>)}
                      </div>
                      <a className="mt-4 inline-flex text-sm font-semibold text-[var(--accent)]" href={resource.url} rel="noreferrer" target="_blank">Open resource →</a>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function StatusBadge({ status }: { status: ResourceStatus }) {
  const labels: Record<ResourceStatus, string> = { active: "Ready", snoozed: "Snoozed", completed: "Completed", archived: "Archived", unreviewed: "Needs review", unavailable: "Unavailable" };
  const style = status === "completed" ? "bg-[#dff1d8] text-[var(--accent)]" : status === "snoozed" ? "bg-[#fff0c9] text-[#7d5b17]" : "bg-[#f2f4ee] text-[var(--muted)]";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{labels[status]}</span>;
}
