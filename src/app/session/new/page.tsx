"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  buildSession,
  type EnergyMode,
  type RecommendationQueue,
  type RecommendationResource,
} from "@/features/recommendations";
import {
  createDemoResources,
  DEMO_PRIMARY_GOAL_IDS,
} from "@/features/recommendations/demo-fixtures";
import { saveStoredSession } from "@/features/sessions/local-session-store";
import { createClient } from "@/lib/supabase/client";

const durations = [2, 5, 10, 20] as const;
const energyOptions: Array<{ value: EnergyMode; label: string; detail: string }> = [
  { value: "quick", label: "Quick", detail: "Light and immediately useful" },
  { value: "balanced", label: "Balanced", detail: "A practical mix" },
  { value: "focused", label: "Focused", detail: "More demanding material" },
  { value: "surprise", label: "Surprise me", detail: "Explore across your goals" },
];

type ResourceRow = {
  id: string;
  url: string;
  source: string;
  content_type: string;
  title: string | null;
  estimated_minutes: number;
  cognitive_effort: number | null;
  actionability: number | null;
  time_sensitivity: number | null;
  time_sensitivity_reason: string | null;
  saved_at: string;
  published_at: string | null;
  relevant_until: string | null;
  status: RecommendationResource["status"];
  snoozed_until: string | null;
  resource_goals: Array<{ goal_id: string; relevance: number }>;
  categories: string[];
};

type GoalOption = { id: string; name: string; is_primary: boolean };
type ResourceWithContext = RecommendationResource & { categories: string[] };

export default function NewSessionPage() {
  const router = useRouter();
  const [minutes, setMinutes] = useState<number>(10);
  const [energyMode, setEnergyMode] = useState<EnergyMode>("balanced");
  const [resources, setResources] = useState<ResourceWithContext[]>([]);
  const [goals, setGoals] = useState<GoalOption[]>([]);
  const [primaryGoalIds, setPrimaryGoalIds] = useState<string[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState("");
  const [usingDemoResources, setUsingDemoResources] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<RecommendationQueue | null>(null);
  const [queueModified, setQueueModified] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadInputs() {
      const now = new Date().toISOString();
      const requestedGoalId = new URLSearchParams(window.location.search).get("goal") ?? "";
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        if (!active) return;
        setResources(createDemoResources(now).map((resource) => ({ ...resource, categories: [] })));
        setPrimaryGoalIds(DEMO_PRIMARY_GOAL_IDS);
        setUsingDemoResources(true);
        setLoading(false);
        return;
      }

      const [profileResult, goalsResult, resourcesResult] = await Promise.all([
        supabase.from("profiles").select("default_session_minutes").eq("id", authData.user.id).maybeSingle(),
        supabase.from("goals").select("id, name, is_primary").eq("user_id", authData.user.id).eq("active", true).order("is_primary", { ascending: false }),
        supabase
          .from("resources")
          .select("id, url, source, content_type, title, estimated_minutes, cognitive_effort, actionability, time_sensitivity, time_sensitivity_reason, saved_at, published_at, relevant_until, status, snoozed_until, categories, resource_goals(goal_id, relevance)")
          .eq("user_id", authData.user.id)
          .in("status", ["active", "snoozed"]),
      ]);

      if (!active) return;

      if (profileResult.data?.default_session_minutes) {
        setMinutes(profileResult.data.default_session_minutes);
      }

      const rows = (resourcesResult.data ?? []) as unknown as ResourceRow[];
      if (resourcesResult.error || rows.length === 0) {
        setResources(createDemoResources(now).map((resource) => ({ ...resource, categories: [] })));
        setPrimaryGoalIds(DEMO_PRIMARY_GOAL_IDS);
        setUsingDemoResources(true);
        setMessage(
          resourcesResult.error
            ? "Your backlog could not be loaded, so this session will use sample saves."
            : "Your backlog is empty, so this session will use sample saves.",
        );
      } else {
        setResources(rows.map(mapResourceRow));
        const loadedGoals = (goalsResult.data ?? []) as GoalOption[];
        setGoals(loadedGoals);
        setSelectedGoalId(loadedGoals.some((goal) => goal.id === requestedGoalId)
          ? requestedGoalId
          : loadedGoals.find((goal) => goal.is_primary)?.id ?? "");
        setPrimaryGoalIds(
          loadedGoals
            .filter((goal) => goal.is_primary)
            .map((goal) => goal.id),
        );
      }

      setLoading(false);
    }

    loadInputs();
    return () => {
      active = false;
    };
  }, []);

  async function startSession() {
    setStarting(true);
    setMessage("");
    const now = new Date().toISOString();
    const eligibleResources = selectedGoalId
      ? resources.filter((resource) => resource.goalMatches.some((match) => match.goalId === selectedGoalId))
      : resources;
    const queue = buildSession(eligibleResources, {
      timeBudgetMinutes: minutes,
      energyMode,
      primaryGoalIds,
      now,
    });

    if (queue.items.length === 0) {
      setMessage("Nothing fits this session. Try a longer duration or add a shorter save.");
      setStarting(false);
      return;
    }

    setPreview(queue);
    setQueueModified(false);
    setStarting(false);
  }

  async function confirmSession(queue: RecommendationQueue) {
    setStarting(true);
    setMessage("");
    const now = new Date().toISOString();
    let id = `demo-${crypto.randomUUID()}`;
    let persisted = false;

    if (!usingDemoResources) {
      const { data, error } = await createClient().rpc("create_recommendation_session", {
        p_time_budget_minutes: minutes,
        p_energy_mode: energyMode,
        p_items: queue.items.map((item, position) => ({
          resource_id: item.resource.id,
          position,
          score: item.score,
          explanation: item.explanations.join(" · "),
        })),
      });

      if (!error && typeof data === "string") {
        id = data;
        persisted = true;
      }
    }

    saveStoredSession({
      id,
      createdAt: now,
      timeBudgetMinutes: minutes,
      energyMode,
      totalMinutes: queue.totalMinutes,
      persisted,
      usingDemoResources,
      items: queue.items,
      outcomes: {},
      currentIndex: 0,
      userModified: queueModified,
    });
    router.push(`/session/${id}`);
  }

  function updatePreviewItems(updater: (items: RecommendationQueue["items"]) => RecommendationQueue["items"]) {
    if (!preview) return;
    const items = updater(preview.items);
    const totalMinutes = items.reduce((total, item) => total + item.resource.estimatedMinutes, 0);
    setPreview({ ...preview, items, totalMinutes, unusedMinutes: Math.max(0, minutes - totalMinutes) });
    setQueueModified(true);
  }

  function removeAndRecurate(index: number) {
    if (!preview) return;
    const removedId = preview.items[index].resource.id;
    const remaining = preview.items.filter((_, itemIndex) => itemIndex !== index);
    const usedIds = new Set(remaining.map((item) => item.resource.id));
    const remainingMinutes = remaining.reduce((total, item) => total + item.resource.estimatedMinutes, 0);
    const candidates = resources.filter((resource) =>
      resource.id !== removedId &&
      !usedIds.has(resource.id) &&
      (!selectedGoalId || resource.goalMatches.some((match) => match.goalId === selectedGoalId)),
    );
    const replacement = buildSession(candidates, {
      timeBudgetMinutes: Math.max(1, minutes - remainingMinutes),
      energyMode,
      primaryGoalIds,
      now: new Date().toISOString(),
    }).items[0];
    const items = replacement ? [...remaining, replacement] : remaining;
    const totalMinutes = items.reduce((total, item) => total + item.resource.estimatedMinutes, 0);
    setPreview({ ...preview, items, totalMinutes, unusedMinutes: Math.max(0, minutes - totalMinutes) });
    setQueueModified(true);
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <Link className="text-lg font-semibold" href="/dashboard">
            Resurface<span className="text-[var(--accent)]">.AI</span>
          </Link>
          {usingDemoResources && (
            <span className="rounded-full bg-[#e9f3e5] px-3 py-1 text-xs font-semibold text-[var(--accent)]">Sample backlog</span>
          )}
        </header>

        <section className="mt-12 rounded-[2rem] border border-[var(--border)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Build your session</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">What fits right now?</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">You choose the time and energy. Resurface chooses a finite, useful queue.</p>

          {!usingDemoResources && goals.length > 0 && (
            <fieldset className="mt-8">
              <legend className="font-semibold">What do you want to prioritize?</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button aria-pressed={!selectedGoalId} className={`rounded-2xl border p-4 text-left ${!selectedGoalId ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)]"}`} onClick={() => { setSelectedGoalId(""); setPreview(null); }} type="button"><strong>Balanced across goals</strong><span className="mt-1 block text-sm text-[var(--muted)]">Let the optimizer mix your current priorities.</span></button>
                {goals.map((goal) => <button aria-pressed={selectedGoalId === goal.id} className={`rounded-2xl border p-4 text-left ${selectedGoalId === goal.id ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)]"}`} key={goal.id} onClick={() => { setSelectedGoalId(goal.id); setPreview(null); }} type="button"><strong>{goal.name}</strong><span className="mt-1 block text-sm text-[var(--muted)]">{goal.is_primary ? "Your main focus" : "Only saves linked to this goal"}</span></button>)}
              </div>
            </fieldset>
          )}

          <fieldset className="mt-8">
            <legend className="font-semibold">How much time do you have?</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {durations.map((duration) => (
                <button
                  aria-pressed={minutes === duration}
                  className={`min-h-14 rounded-2xl border font-semibold transition ${minutes === duration ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`}
                  key={duration}
                  onClick={() => { setMinutes(duration); setPreview(null); }}
                  type="button"
                >
                  {duration} min
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-8">
            <legend className="font-semibold">What kind of energy do you have?</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {energyOptions.map((option) => (
                <button
                  aria-pressed={energyMode === option.value}
                  className={`rounded-2xl border p-4 text-left transition ${energyMode === option.value ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)]"}`}
                  key={option.value}
                  onClick={() => { setEnergyMode(option.value); setPreview(null); }}
                  type="button"
                >
                  <span className="font-semibold">{option.label}</span>
                  <span className="mt-1 block text-sm text-[var(--muted)]">{option.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {message && <p className="mt-6 rounded-xl bg-[#f2f4ee] px-4 py-3 text-sm leading-6">{message}</p>}

          <button
            className="mt-8 min-h-12 w-full rounded-full bg-[var(--accent)] px-6 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading || starting}
            onClick={startSession}
            type="button"
          >
            {loading ? "Loading your saves…" : starting ? "Building your queue…" : `Preview my ${minutes}-minute session`}
          </button>
        </section>

        {preview && (
          <section className="mt-6 rounded-[2rem] border border-[var(--accent)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div><p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Your optimized queue</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Here is what fits right now.</h2><p className="mt-3 leading-7 text-[var(--muted)]">Review the order, remove anything that does not feel right, and let the optimizer find a replacement.</p></div>
              <span className="shrink-0 rounded-2xl bg-[#e9f3e5] px-4 py-3 text-sm font-semibold text-[var(--accent)]">{preview.totalMinutes} of {minutes} min</span>
            </div>
            <div className="mt-7 space-y-3">
              {preview.items.map((item, index) => (
                <article className="flex gap-4 rounded-2xl border border-[var(--border)] p-4" key={item.resource.id}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf0e8] text-sm font-bold text-[var(--accent)]">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{item.resource.title}</h3><span className="text-xs font-semibold text-[var(--muted)]">{item.resource.estimatedMinutes} min</span></div><p className="mt-1 text-sm text-[var(--muted)]">{item.explanations.join(" · ")}</p><span className="mt-2 inline-flex rounded-full bg-[#edf0e8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">{queueModified ? "User adjusted" : "Optimizer pick"}</span></div>
                  <div className="flex shrink-0 flex-col items-end gap-1"><button aria-label={`Move ${item.resource.title} up`} className="px-2 text-sm disabled:opacity-30" disabled={index === 0} onClick={() => updatePreviewItems((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} type="button">↑</button><button aria-label={`Move ${item.resource.title} down`} className="px-2 text-sm disabled:opacity-30" disabled={index === preview.items.length - 1} onClick={() => updatePreviewItems((items) => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })} type="button">↓</button><button className="text-xs font-semibold text-[#8a3a33]" onClick={() => removeAndRecurate(index)} type="button">Remove</button></div>
                </article>
              ))}
            </div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row"><button className="min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white disabled:opacity-60" disabled={starting || preview.items.length === 0} onClick={() => confirmSession(preview)} type="button">{starting ? "Starting…" : "Start this session →"}</button><button className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold" onClick={() => setPreview(null)} type="button">Change choices</button></div>
          </section>
        )}
      </div>
    </main>
  );
}

function mapResourceRow(row: ResourceRow): ResourceWithContext {
  return {
    id: row.id,
    url: row.url,
    source: row.source,
    contentType: row.content_type,
    title: row.title?.trim() || "Untitled save",
    estimatedMinutes: row.estimated_minutes,
    cognitiveEffort: row.cognitive_effort,
    actionability: row.actionability,
    timeSensitivity: row.time_sensitivity,
    timeSensitivityReason: row.time_sensitivity_reason,
    savedAt: row.saved_at,
    publishedAt: row.published_at,
    relevantUntil: row.relevant_until,
    status: row.status,
    snoozedUntil: row.snoozed_until,
    goalMatches: row.resource_goals.map((match) => ({
      goalId: match.goal_id,
      relevance: match.relevance,
    })),
    categories: row.categories ?? [],
  };
}
