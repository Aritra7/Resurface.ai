"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  buildSession,
  type EnergyMode,
  type RecommendationResource,
  type RecommendationQueue,
} from "@/features/recommendations";
import {
  createDemoResources,
  DEMO_TOPICS,
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
};

export default function NewSessionPage() {
  const router = useRouter();
  const [minutes, setMinutes] = useState<number>(10);
  const [energyMode, setEnergyMode] = useState<EnergyMode>("balanced");
  const [resources, setResources] = useState<RecommendationResource[]>([]);
  const [primaryGoalIds, setPrimaryGoalIds] = useState<string[]>([]);
  const [usingDemoResources, setUsingDemoResources] = useState(false);
  const [section, setSection] = useState("");
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [pathPreview, setPathPreview] = useState<RecommendationQueue | null>(null);
  const [pathModified, setPathModified] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadInputs() {
      const now = new Date().toISOString();
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const requestedMinutes = Number(new URLSearchParams(window.location.search).get("minutes"));
      const requestedSection = new URLSearchParams(window.location.search).get("section") ?? "";
      const requestedTopic = new URLSearchParams(window.location.search).get("topic") ?? sectionTopic(requestedSection);
      setSection(requestedSection);
      setTopic(requestedTopic);
      if (durations.includes(requestedMinutes as (typeof durations)[number])) {
        setMinutes(requestedMinutes);
      }

      if (!authData.user) {
        if (!active) return;
        const demoResources = createDemoResources(now);
        setResources(demoResources.filter((resource) => (!requestedSection || resource.section === requestedSection) && (!requestedTopic || resource.topic === requestedTopic)));
        setPrimaryGoalIds(DEMO_PRIMARY_GOAL_IDS);
        setUsingDemoResources(true);
        setLoading(false);
        return;
      }

      const [profileResult, goalsResult, resourcesResult] = await Promise.all([
        supabase.from("profiles").select("default_session_minutes").eq("id", authData.user.id).maybeSingle(),
        supabase.from("goals").select("id, is_primary").eq("user_id", authData.user.id).eq("active", true),
        supabase
          .from("resources")
          .select("id, url, source, content_type, title, estimated_minutes, cognitive_effort, actionability, time_sensitivity, time_sensitivity_reason, saved_at, published_at, relevant_until, status, snoozed_until, resource_goals(goal_id, relevance)")
          .eq("user_id", authData.user.id)
          .in("status", ["active", "snoozed"]),
      ]);

      if (!active) return;

      if (!durations.includes(requestedMinutes as (typeof durations)[number]) && profileResult.data?.default_session_minutes) {
        setMinutes(profileResult.data.default_session_minutes);
      }

      const rows = (resourcesResult.data ?? []) as unknown as ResourceRow[];
      if (resourcesResult.error || rows.length === 0) {
        const demoResources = createDemoResources(now);
        setResources(demoResources.filter((resource) => (!requestedSection || resource.section === requestedSection) && (!requestedTopic || resource.topic === requestedTopic)));
        setPrimaryGoalIds(DEMO_PRIMARY_GOAL_IDS);
        setUsingDemoResources(true);
        setMessage(
          resourcesResult.error
            ? "Your backlog could not be loaded, so this session will use sample saves."
            : "Your backlog is empty, so this session will use sample saves.",
        );
      } else {
        setResources(rows.map(mapResourceRow));
        setPrimaryGoalIds(
          ((goalsResult.data ?? []) as Array<{ id: string; is_primary: boolean }>)
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
    if (!topic) {
      setMessage("Choose a topic first so we can build the right learning path.");
      return;
    }
    setStarting(true);
    setMessage("");
    const now = new Date().toISOString();
    const queue = buildSession(resources.filter((resource) => resource.topic === topic), {
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
    setPathPreview(queue);
    setPathModified(false);
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
      userModified: pathModified,
    });
    router.push(`/session/${id}`);
  }

  function updatePreviewItems(updater: (items: RecommendationQueue["items"]) => RecommendationQueue["items"]) {
    if (!pathPreview) return;
    const items = updater(pathPreview.items);
    const totalMinutes = items.reduce((total, item) => total + item.resource.estimatedMinutes, 0);
    setPathPreview({ ...pathPreview, items, totalMinutes, unusedMinutes: Math.max(0, minutes - totalMinutes) });
    setPathModified(true);
  }

  function removeAndRecurate(index: number) {
    if (!pathPreview) return;
    const removed = pathPreview.items[index].resource.id;
    const remaining = pathPreview.items.filter((_, itemIndex) => itemIndex !== index);
    const usedIds = new Set(remaining.map((item) => item.resource.id));
    const remainingMinutes = remaining.reduce((total, item) => total + item.resource.estimatedMinutes, 0);
    const replacement = buildSession(
      resources.filter((resource) => resource.topic === topic && resource.id !== removed && !usedIds.has(resource.id)),
      { timeBudgetMinutes: Math.max(2, minutes - remainingMinutes), energyMode, primaryGoalIds, now: new Date().toISOString() },
    ).items[0];
    const items = replacement ? [...remaining, replacement] : remaining;
    const totalMinutes = items.reduce((total, item) => total + item.resource.estimatedMinutes, 0);
    setPathPreview({ ...pathPreview, items, totalMinutes, unusedMinutes: Math.max(0, minutes - totalMinutes) });
    setPathModified(true);
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link className="text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]" href="/">
              ← Main page
            </Link>
            <div className="flex items-center gap-4"><Link className="text-lg font-semibold" href="/dashboard">Resurface<span className="text-[var(--accent)]">.AI</span></Link><Link className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" href="/resources">Resources</Link></div>
          </div>
          <div className="flex items-center gap-3">
            {usingDemoResources && (
              <span className="rounded-full bg-[#e9f3e5] px-3 py-1 text-xs font-semibold text-[var(--accent)]">Sample backlog</span>
            )}
          </div>
        </header>

        <section className="mt-12 rounded-[2rem] border border-[var(--border)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Build your session</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{topic ? DEMO_TOPICS.find((item) => item.id === topic)?.label : section ? section : "What fits right now?"}</h1>
          <p className="mt-3 leading-7 text-[var(--muted)]">{topic || section ? "Choose the time and energy for this topic. Resurface will build a focused queue from its organized saves." : "You choose a topic, time, and energy. Resurface chooses a finite, useful queue."}</p>

          <fieldset className="mt-8">
            <legend className="font-semibold">What do you want to work on?</legend>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {DEMO_TOPICS.map((option) => (
                <button
                  aria-pressed={topic === option.id}
                  className={`rounded-2xl border p-4 text-left transition ${topic === option.id ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)]"}`}
                  key={option.id}
                  onClick={() => { setTopic(option.id); setSection(""); }}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2"><strong>{option.label}</strong><b className="text-[var(--accent)]">{option.progress}%</b></span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{option.detail}</span>
                  <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#dfe9db]"><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${option.progress}%` }} /></span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-8">
            <legend className="font-semibold">How much time do you have?</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {durations.map((duration) => (
                <button
                  aria-pressed={minutes === duration}
                  className={`min-h-14 rounded-2xl border font-semibold transition ${minutes === duration ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`}
                  key={duration}
                  onClick={() => setMinutes(duration)}
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
                  onClick={() => setEnergyMode(option.value)}
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
            {loading ? "Loading your saves…" : starting ? "Building your path…" : `Preview my ${minutes}-minute path`}
          </button>
        </section>

        {pathPreview && (
          <section className="mt-6 rounded-[2rem] border border-[var(--accent)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Your learning path</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">Here is what fits your {minutes} minutes.</h2>
                <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">We organized this path around <strong>{topicLabel(topic)}</strong>, your <strong>{energyMode}</strong> focus, and the resources that fit without cutting anything in half.</p>
              </div>
              <div className="rounded-2xl bg-[#e9f3e5] px-4 py-3 text-sm font-semibold text-[var(--accent)]">{pathPreview.totalMinutes} of {minutes} min planned</div>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <PathStat label="Topic" value={topicLabel(topic)} />
              <PathStat label="Focus" value={energyModeLabel(energyMode)} />
              <PathStat label="Resources" value={`${pathPreview.items.length} selected`} />
            </div>
            <div className="mt-8">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Session path</p>
              <div className="mt-3 space-y-3">
                {pathPreview.items.map((item, index) => (
                  <article className="flex gap-4 rounded-2xl border border-[var(--border)] p-4" key={item.resource.id}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf0e8] text-sm font-bold text-[var(--accent)]">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{item.resource.title}</h3><span className="text-xs font-semibold text-[var(--muted)]">{item.resource.estimatedMinutes} min</span></div><p className="mt-1 text-sm text-[var(--muted)]">{item.explanations.join(" · ")}</p><span className="mt-2 inline-flex rounded-full bg-[#edf0e8] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">{pathModified ? "User-adjusted path" : "AI recommended"}</span></div>
                    <div className="flex shrink-0 flex-col gap-1"><button aria-label={`Move ${item.resource.title} up`} className="text-sm text-[var(--muted)] disabled:opacity-30" disabled={index === 0} onClick={() => updatePreviewItems((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })} type="button">↑</button><button aria-label={`Move ${item.resource.title} down`} className="text-sm text-[var(--muted)] disabled:opacity-30" disabled={index === pathPreview.items.length - 1} onClick={() => updatePreviewItems((items) => { const next = [...items]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })} type="button">↓</button><button aria-label={`Remove ${item.resource.title}`} className="text-xs font-semibold text-[#9c5d55]" onClick={() => removeAndRecurate(index)} type="button">Remove & re-curate</button></div>
                  </article>
                ))}
              </div>
            </div>
            <div className="mt-7 rounded-2xl bg-[#f2f4ee] p-4 text-sm leading-6"><strong>What this advances:</strong> {topicObjective(topic)} You will finish with {Math.round((pathPreview.totalMinutes / minutes) * 100)}% of your available time intentionally planned.</div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row"><button className="min-h-12 rounded-full bg-[var(--accent)] px-6 font-semibold text-white disabled:opacity-60" disabled={starting} onClick={() => confirmSession(pathPreview)} type="button">{starting ? "Opening your session…" : "Start this learning path →"}</button><button className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold" onClick={() => setPathPreview(null)} type="button">Change choices</button></div>
          </section>
        )}
      </div>
    </main>
  );
}

function topicLabel(topic: string) {
  return DEMO_TOPICS.find((item) => item.id === topic)?.label ?? "your selected topic";
}

function sectionTopic(section: string) {
  const topics: Record<string, string> = {
    "Build a sustainable practice": "workout",
    "Understand the foundations": "java",
    "Build something useful": "ai",
    "Make ideas actionable": "career",
  };
  return topics[section] ?? "";
}

function topicObjective(topic: string) {
  const objectives: Record<string, string> = {
    workout: "This session supports a sustainable movement practice.",
    java: "This session builds technical foundations you can apply in code.",
    ai: "This session builds practical AI understanding from foundations to application.",
    career: "This session turns saved career and product ideas into actionable next steps.",
  };
  return objectives[topic] ?? "This session moves your current learning goal forward.";
}

function energyModeLabel(mode: EnergyMode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function PathStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-[#f2f4ee] p-4"><span className="block text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</span><strong className="mt-1 block text-lg text-[var(--accent)]">{value}</strong></div>;
}

function mapResourceRow(row: ResourceRow): RecommendationResource {
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
  };
}
