"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listStoredSessions, type StoredSession } from "@/features/sessions/local-session-store";
import { createDemoResources } from "@/features/recommendations/demo-fixtures";

type Profile = {
  display_name: string;
  default_session_minutes: number;
  onboarding_completed: boolean;
};

type Goal = {
  id: string;
  name: string;
  is_primary: boolean;
};

type Session = {
  id: string;
  time_budget_minutes: number;
  energy_mode: string;
  started_at: string;
  completed_at: string | null;
};

type ResourceRecord = {
  id: string;
  title: string | null;
  source: string;
  estimated_minutes: number;
  status: string;
  saved_at: string;
  topic?: string;
  resource_goals?: Array<{ goal_id: string }>;
};

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [localSessions, setLocalSessions] = useState<StoredSession[]>([]);
  const [resourceRecords, setResourceRecords] = useState<ResourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.replace("/login");
        return;
      }

      const [profileResult, goalsResult, resourcesResult, sessionsResult] = await Promise.all([
        supabase.from("profiles").select("display_name, default_session_minutes, onboarding_completed").eq("id", authData.user.id).maybeSingle(),
        supabase.from("goals").select("id, name, is_primary").eq("user_id", authData.user.id).eq("active", true).order("is_primary", { ascending: false }),
        supabase.from("resources").select("id, title, source, estimated_minutes, status, saved_at, resource_goals(goal_id)").eq("user_id", authData.user.id).not("status", "in", "(archived,unavailable)"),
        supabase.from("sessions").select("id, time_budget_minutes, energy_mode, started_at, completed_at").eq("user_id", authData.user.id).order("started_at", { ascending: false }).limit(6),
      ]);

      if (!active) return;
      if (profileResult.error || goalsResult.error || resourcesResult.error) {
        setError(profileResult.error?.message ?? goalsResult.error?.message ?? resourcesResult.error?.message ?? "Could not load your dashboard.");
        setLoading(false);
        return;
      }
      if (!profileResult.data?.onboarding_completed) {
        router.replace("/onboarding");
        return;
      }

      setProfile(profileResult.data);
      setGoals(goalsResult.data ?? []);
      setSessions(sessionsResult.error ? [] : sessionsResult.data ?? []);
      const loadedResources = (resourcesResult.data ?? []) as unknown as ResourceRecord[];
      const goalNames = new Map((goalsResult.data ?? []).map((goal) => [goal.id, goal.name]));
      const dashboardResources = loadedResources.length > 0
        ? loadedResources.map((resource) => ({
          ...resource,
          topic: resource.topic ?? resource.resource_goals?.map((match) => goalNames.get(match.goal_id)).find(Boolean) ?? "Unassigned topic",
        }))
        : createDemoResources(new Date().toISOString()).map((resource) => ({
          id: resource.id,
          title: resource.title,
          source: resource.source,
          estimated_minutes: resource.estimatedMinutes,
          status: resource.status,
          saved_at: resource.savedAt,
          topic: resource.topic ?? resource.section ?? "Unassigned topic",
        }));
      setResourceRecords(dashboardResources);
      setLocalSessions(listStoredSessions());
      setLoading(false);
      if (!window.localStorage.getItem("resurface-dashboard-tour-complete")) {
        setTourOpen(true);
      }
    }

    loadDashboard();
    const refreshDashboard = () => setRefreshToken((token) => token + 1);
    window.addEventListener("storage", refreshDashboard);
    window.addEventListener("resurface:state-changed", refreshDashboard);
    window.addEventListener("focus", refreshDashboard);
    return () => {
      active = false;
      window.removeEventListener("storage", refreshDashboard);
      window.removeEventListener("resurface:state-changed", refreshDashboard);
      window.removeEventListener("focus", refreshDashboard);
    };
  }, [router, refreshToken]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }

  function closeTour() {
    window.localStorage.setItem("resurface-dashboard-tour-complete", "true");
    setTourOpen(false);
    setTourStep(0);
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center">Loading your dashboard…</main>;

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <section className="max-w-lg rounded-3xl border border-[var(--border)] bg-white p-8 text-center">
          <h1 className="text-2xl font-semibold">We could not load your dashboard.</h1>
          <p className="mt-3 text-[var(--muted)]">{error}</p>
          <Link className="mt-6 inline-flex rounded-full bg-[var(--accent)] px-5 py-3 font-semibold text-white" href="/onboarding">Return to setup</Link>
        </section>
      </main>
    );
  }

  const primaryGoal = goals.find((goal) => goal.is_primary)?.name ?? "your goals";
  const serverSessionIds = new Set(sessions.map((session) => session.id));
  const extraLocalSessions = localSessions.filter((session) => !serverSessionIds.has(session.id));
  const localOutcomes = new Map<string, string>();
  for (const localSession of localSessions) {
    for (const [resourceId, outcome] of Object.entries(localSession.outcomes)) {
      localOutcomes.set(resourceId, outcome);
    }
  }
  const effectiveResources = resourceRecords.map((resource) => {
    const localOutcome = localOutcomes.get(resource.id);
    return localOutcome === "completed" ? { ...resource, status: "completed" } : localOutcome === "snoozed" ? { ...resource, status: "snoozed" } : resource;
  });
  const completedResources = effectiveResources.filter((resource) => resource.status === "completed");
  const journeyResources = effectiveResources.filter((resource) => !["archived", "unavailable"].includes(resource.status));
  const completedSessions = sessions.filter((session) => session.completed_at).length + extraLocalSessions.filter(isLocalComplete).length;
  const startedSessions = sessions.length + extraLocalSessions.length;
  const totalActions = journeyResources.length;
  const completedActionCount = completedResources.length;
  const inProgressActions = journeyResources.filter((resource) => resource.status === "snoozed").length + extraLocalSessions.filter((session) => !isLocalComplete(session)).length;
  const skippedActions = extraLocalSessions.reduce((count, session) => count + Object.values(session.outcomes).filter((outcome) => outcome === "skipped").length, 0);
  const remainingResources = journeyResources.filter((resource) => resource.status !== "completed");
  const remainingMinutes = remainingResources.reduce((sum, resource) => sum + (resource.estimated_minutes ?? 0), 0);
  const investedMinutes = completedResources.reduce((sum, resource) => sum + (resource.estimated_minutes ?? 0), 0);
  const journeyPercent = totalActions === 0 ? 0 : Math.round((completedActionCount / totalActions) * 100);
  const nextMilestonePercent = journeyPercent < 25 ? 25 : journeyPercent < 50 ? 50 : journeyPercent < 75 ? 75 : 100;
  const progressToMilestone = Math.max(0, Math.ceil((nextMilestonePercent / 100) * Math.max(totalActions, 1)) - completedActionCount);
  const currentStage = journeyPercent < 25 ? "Foundation" : journeyPercent < 50 ? "Development" : journeyPercent < 75 ? "Progression" : "Mastery";
  const activeSession = sessions.find((session) => !session.completed_at) ?? extraLocalSessions.find((session) => !isLocalComplete(session));
  const activeSessionMinutes = activeSession && "time_budget_minutes" in activeSession ? activeSession.time_budget_minutes : activeSession?.timeBudgetMinutes;
  const categories = groupResourcesByCategory(journeyResources);
  const checklist = [
    { label: "Choose a goal that matters", done: goals.length > 0 },
    { label: "Build your first learning session", done: startedSessions > 0 },
    { label: "Complete a curated activity", done: completedActionCount > 0 },
    { label: `Reach ${nextMilestonePercent}% journey progress`, done: journeyPercent >= nextMilestonePercent },
  ];

  return (
    <main className="min-h-screen bg-[#f5f6ef] px-5 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-4">
          <Link className="text-lg font-semibold tracking-tight" data-tour="brand" href="/">Resurface<span className="text-[var(--accent)]">.AI</span></Link>
          <div className="flex items-center gap-4">
            <Link className="text-sm font-semibold text-[var(--accent)]" href="/dashboard">Dashboard</Link>
            <Link className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" href="/resources">Resources</Link>
            <Link className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href="/session/new">Build my session</Link>
            <button className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" onClick={() => { setTourStep(0); setTourOpen(true); }} type="button">Show walkthrough</button>
            <Link className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" href="/onboarding">Settings</Link>
            <button className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" onClick={signOut} type="button">Sign out</button>
          </div>
        </header>

        <section className="mt-12 grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div className="relative">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{sessions.length ? "Welcome back" : "Your first step"}</p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              {sessions.length ? `Pick up where you left off, ${profile?.display_name}.` : `Start building your ${primaryGoal.toLowerCase()} habit.`}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              You have completed {completedActionCount} of {totalActions || startedSessions} learning actions. There is one clear next action whenever you are ready.
            </p>
          </div>
          <article className="rounded-[2rem] border-2 border-[var(--border)] bg-white p-6 shadow-[0_6px_0_#dce6d8,0_20px_60px_rgba(40,65,46,0.06)]" data-tour="journey">
            <div className="flex items-end justify-between"><div><p className="text-sm font-medium text-[var(--muted)]">Your learning journey</p><p className="mt-1 text-xl font-semibold">{currentStage}</p></div><strong className="text-3xl font-semibold text-[var(--accent)]">{journeyPercent}%</strong></div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(5, journeyPercent)}%` }} /></div>
            <div className="mt-3 flex justify-between text-xs text-[var(--muted)]"><span>{completedActionCount} of {totalActions || startedSessions} actions complete</span><span>{progressToMilestone ? `${progressToMilestone} actions to ${nextMilestonePercent}%` : "Milestone reached"}</span></div>
          </article>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[2rem] bg-[var(--accent)] p-7 text-white shadow-[0_24px_60px_rgba(47,111,78,0.2)] sm:p-9" data-tour="next-action">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">{activeSession ? "Continue where you left off" : "Your next best action"}</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">{activeSession ? "Resume your learning session." : "Start a learning workout."}</h2><p className="mt-2 max-w-lg text-white/75">{activeSession ? "Your unfinished session is waiting for you. Pick it up without losing the thread." : "We’ll choose a finite queue from your saves based on your goal, energy, and time."}</p></div><span className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium">{activeSessionMinutes ?? profile?.default_session_minutes} min</span></div>
            <div className="mt-7 rounded-2xl bg-black/10 px-4 py-3 text-sm leading-6 text-white/85"><strong className="text-white">Recommended because:</strong> it prioritizes saves that support <b>{primaryGoal}</b>, fit your available window, and have not been revisited yet. {journeyPercent < nextMilestonePercent ? `Complete the next ${progressToMilestone} action${progressToMilestone === 1 ? "" : "s"} to reach ${nextMilestonePercent}%.` : "Your next milestone is ready."}</div>
            <Link className="mt-6 inline-flex min-h-12 items-center rounded-full bg-white px-6 font-semibold text-[var(--accent)] transition hover:bg-[#eef8eb]" href={activeSession ? `/session/${activeSession.id}` : "/session/new"}>{activeSession ? "Resume session" : "Choose your time"} <span className="ml-4 text-xl">→</span></Link>
          </article>
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-7">
            <p className="text-sm font-medium text-[var(--muted)]">What you’ve accomplished</p>
            <div className="mt-4 grid grid-cols-3 gap-3"><Stat value={completedActionCount} label="actions done" /><Stat value={remainingResources.length} label="actions left" /><Stat value={inProgressActions} label="in progress" /></div>
            <p className="mt-5 text-sm leading-6 text-[var(--muted)]">Your progress is based on completed source actions. Partial sessions remain resumable without being counted as complete.</p>
          </article>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-7">
            <div className="flex items-end justify-between gap-4"><div><p className="text-sm font-medium text-[var(--muted)]">Overall progress</p><h2 className="mt-1 text-2xl font-semibold">{journeyPercent}% complete</h2></div><span className="text-sm text-[var(--muted)]">{completedActionCount} of {totalActions || 0} actions</span></div>
            <div className="mt-5 h-4 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${journeyPercent}%` }} /></div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Remaining" value={`${remainingResources.length}`} detail="actions" /><Metric label="Time left" value={formatMinutes(remainingMinutes)} detail="estimated" /><Metric label="Invested" value={formatMinutes(investedMinutes)} detail="estimated" /><Metric label="Skipped" value={`${skippedActions}`} detail="actions" /></div>
          </article>
          <article className="rounded-[2rem] border border-[var(--border)] bg-[#edf5e9] p-6 sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Next milestone</p>
            <h2 className="mt-2 text-2xl font-semibold">Reach {nextMilestonePercent}% completion</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{progressToMilestone ? `${progressToMilestone} action${progressToMilestone === 1 ? "" : "s"} to go in your ${currentStage.toLowerCase()} stage.` : "You reached this milestone. Your next recommendation is ready."}</p>
            <div className="mt-5 flex items-center justify-between text-sm"><span className="font-medium">{currentStage}</span><strong className="text-[var(--accent)]">{journeyPercent}%</strong></div>
          </article>
        </section>

        <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-medium text-[var(--muted)]">What&apos;s left to learn</p><h2 className="mt-1 text-2xl font-semibold">What do you want to work on?</h2><p className="mt-2 text-sm text-[var(--muted)]">Choose a topic to see its path, sessions, and remaining action items.</p></div><span className="text-sm text-[var(--muted)]">{categories.length} active topics</span></div>
          {categories.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm leading-6 text-[var(--muted)]">Your topic breakdown will appear after resources are added.</p> : <div className="mt-6 grid gap-4 md:grid-cols-2">{categories.map((category) => <Link className="rounded-2xl border border-[var(--border)] p-5 transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_12px_30px_rgba(40,65,46,0.06)]" href="/session/new" key={category.name}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Learning topic</p><strong className="mt-1 block text-lg">{category.name}</strong></div><span className="rounded-full bg-[#e9f3e5] px-3 py-1 text-sm font-bold text-[var(--accent)]">{category.percent}%</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${category.percent}%` }} /></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f2f4ee] p-3"><span className="block text-xs text-[var(--muted)]">Sessions</span><strong className="mt-1 block text-base text-[var(--foreground)]">{category.completed} / {category.total}</strong></div><div className="rounded-xl bg-[#f2f4ee] p-3"><span className="block text-xs text-[var(--muted)]">Action items left</span><strong className="mt-1 block text-base text-[var(--foreground)]">{category.remaining}</strong></div></div><div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-[var(--muted)]"><span>{category.status}</span><span>{formatMinutes(category.remainingMinutes)} remaining</span></div></Link>)}</div>}
        </section>

        <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-7" data-tour="time-choice">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-[var(--muted)]">Change the plan, not the commitment</p><h2 className="mt-1 text-2xl font-semibold">How much time do you have?</h2></div><span className="text-sm text-[var(--muted)]">Your queue will be re-curated</span></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">{[5, 10, 20].map((minutes) => <Link className={`rounded-2xl border p-4 transition hover:border-[var(--accent)] ${profile?.default_session_minutes === minutes ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)]"}`} href={`/session/new?minutes=${minutes}`} key={minutes}><strong className="block text-lg">{minutes} minutes</strong><span className="mt-1 block text-sm text-[var(--muted)]">{minutes === 5 ? "Quick reset" : minutes === 10 ? "Balanced" : "Deep dive"}</span></Link>)}</div>
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-7" data-tour="path">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-sm font-medium text-[var(--muted)]">Your learning path</p><h2 className="mt-1 text-2xl font-semibold">One journey, one next step.</h2></div>
              <span className="rounded-full bg-[#edf0e8] px-3 py-1 text-sm font-semibold text-[var(--accent)]">{journeyPercent}% complete</span>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">Your path is built from the sessions you actually start and complete. It adapts when you change goals, time, or how you work through a save.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <PathStage active={completedSessions === 0} done={completedSessions > 0} label="Understand" detail="Choose what matters" />
              <PathStage active={completedSessions > 0 && completedSessions < 3} done={completedSessions >= 3} label="Practice" detail="Complete useful sessions" />
              <PathStage active={completedSessions >= 3} done={completedSessions >= 5} label="Build momentum" detail="Return and reinforce" />
            </div>
            <div className="mt-6 rounded-2xl bg-[#f2f4ee] p-4 text-sm"><strong>Next milestone:</strong> {progressToMilestone ? `${progressToMilestone} more completed ${progressToMilestone === 1 ? "action" : "actions"} to reach ${nextMilestonePercent}%.` : "Milestone reached. Your next recommendation is ready."}</div>
          </article>
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-7" data-tour="checklist">
            <p className="text-sm font-medium text-[var(--muted)]">Your checklist</p>
            <h2 className="mt-1 text-2xl font-semibold">Keep the thread.</h2>
            <div className="mt-5 space-y-3">
              {checklist.map((item) => <div className="flex items-start gap-3" key={item.label}><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.done ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--muted)]"}`}>{item.done ? "✓" : "○"}</span><span className={`text-sm leading-6 ${item.done ? "text-[var(--muted)] line-through" : "font-medium"}`}>{item.label}</span></div>)}
            </div>
          </article>
        </section>

        <section className="mt-6 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-7" data-tour="history">
          <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-[var(--muted)]">Your history</p><h2 className="mt-1 text-2xl font-semibold">Small steps, kept visible.</h2></div><span className="rounded-full bg-[#edf0e8] px-3 py-1 text-sm font-medium text-[var(--accent)]">{sessions.length} sessions</span></div>
          {sessions.length === 0 ? <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm leading-6 text-[var(--muted)]">Your first finished session will appear here. We’ll learn from complete, snooze, archive, and skip decisions over time.</p> : <div className="mt-5 divide-y divide-[var(--border)]">{sessions.slice(0, 4).map((session) => <div className="flex items-center justify-between gap-4 py-4 first:pt-0" key={session.id}><div><p className="font-medium">{session.time_budget_minutes}-minute {session.energy_mode} session</p><p className="mt-1 text-xs text-[var(--muted)]">{new Date(session.started_at).toLocaleDateString()} · {session.completed_at ? "Completed" : "In progress"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${session.completed_at ? "bg-[#e9f3e5] text-[var(--accent)]" : "bg-[#fff3d9] text-[#8a641c]"}`}>{session.completed_at ? "Done" : "Resume"}</span></div>)}</div>}
        </section>
      </div>
      {tourOpen && <DashboardTour step={tourStep} onClose={closeTour} onStepChange={setTourStep} />}
    </main>
  );
}

const tourSteps = [
  {
    target: "brand",
    kicker: "WELCOME TO RESURFACE",
    title: "Your saves are about to become useful.",
    copy: "We turn the things you saved into a focused learning session built around what you care about and the time you have.",
  },
  {
    target: "journey",
    kicker: "YOUR LEARNING JOURNEY",
    title: "See where your small steps are taking you.",
    copy: "Your journey tracks completed sessions, not just opened links. Every finished session moves you toward the next milestone.",
  },
  {
    target: "next-action",
    kicker: "YOUR NEXT STEP",
    title: "Never wonder what to do next.",
    copy: "This is your clearest next action. We explain why it is recommended, then let you choose the time and energy that fit today.",
  },
  {
    target: "time-choice",
    kicker: "FLEXIBLE BY DESIGN",
    title: "Change the plan, not the commitment.",
    copy: "Pick five minutes for a quick reset or go deeper when you have more space. Your queue is re-curated around that choice.",
  },
  {
    target: "path",
    kicker: "YOUR LEARNING PATH",
    title: "See what your sessions are building toward.",
    copy: "Understand, practice, and build momentum are views of the same journey—not separate features. Your current stage follows your real session history.",
  },
  {
    target: "checklist",
    kicker: "YOUR CHECKLIST",
    title: "Small actions make the journey concrete.",
    copy: "This checklist is calculated from your goals and activity state. When you complete a session elsewhere, it updates here too.",
  },
  {
    target: "history",
    kicker: "KEEP THE THREAD",
    title: "Your progress remembers the in-between.",
    copy: "Completed, in-progress, and partial sessions stay visible so you can return without starting from scratch.",
  },
];

function DashboardTour({
  step,
  onClose,
  onStepChange,
}: {
  step: number;
  onClose: () => void;
  onStepChange: (step: number) => void;
}) {
  const current = tourSteps[step];
  const [spotlight, setSpotlight] = useState({ top: 16, left: 16, width: 120, height: 40 });

  useEffect(() => {
    const updateSpotlight = () => {
      const target = document.querySelector(`[data-tour="${current.target}"]`);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const padding = 8;
      setSpotlight({
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
    };

    updateSpotlight();
    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    return () => {
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
    };
  }, [current.target]);

  const isLast = step === tourSteps.length - 1;

  return (
    <div aria-label="Resurface walkthrough" className="fixed inset-0 z-50 bg-black/45">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-2xl border-2 border-[#b9ee9b] shadow-[0_0_0_9999px_rgba(12,28,17,0.5),0_0_36px_rgba(185,238,155,0.7)] transition-all duration-300"
        style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height }}
      />
      <section className="fixed bottom-4 left-4 right-4 mx-auto max-w-md rounded-[1.75rem] bg-white p-6 shadow-2xl sm:bottom-8 sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">{current.kicker}</p>
          <button className="text-sm font-medium text-[var(--muted)]" onClick={onClose} type="button">Skip</button>
        </div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">{current.title}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{current.copy}</p>
        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex gap-1.5" aria-label={`Step ${step + 1} of ${tourSteps.length}`}>
            {tourSteps.map((item, index) => <span className={`h-2 w-2 rounded-full ${index === step ? "bg-[var(--accent)]" : "bg-[#dce5d8]"}`} key={item.target} />)}
          </div>
          <button
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
            onClick={() => isLast ? onClose() : onStepChange(step + 1)}
            type="button"
          >
            {step === 0 ? "Show me" : isLast ? "Start exploring" : "Next"}
            <span className="ml-2">→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="rounded-2xl bg-[#f2f4ee] p-3"><strong className="block text-2xl font-semibold text-[var(--accent)]">{value}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{label}</span></div>;
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return <div className="rounded-2xl bg-[#f2f4ee] p-3"><span className="block text-xs font-medium text-[var(--muted)]">{label}</span><strong className="mt-1 block text-xl font-semibold text-[var(--accent)]">{value}</strong><span className="text-[11px] text-[var(--muted)]">{detail}</span></div>;
}

function PathStage({ active, done, detail, label }: { active: boolean; done: boolean; detail: string; label: string }) {
  return <div className={`rounded-2xl border p-4 ${active ? "border-[var(--accent)] bg-[#e9f3e5]" : "border-[var(--border)]"}`}><span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-[var(--accent)] text-white" : active ? "bg-white text-[var(--accent)]" : "bg-[#f2f4ee] text-[var(--muted)]"}`}>{done ? "✓" : active ? "→" : "○"}</span><strong className="mt-3 block text-sm">{label}</strong><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">{detail}</span></div>;
}

function isLocalComplete(session: StoredSession) {
  return session.items.length > 0 && session.items.every((item) => session.outcomes[item.resource.id] === "completed");
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function groupResourcesByCategory(resources: ResourceRecord[]) {
  const groups = new Map<string, ResourceRecord[]>();
  for (const resource of resources) {
    const topic = resource.topic ?? "Unassigned topic";
    groups.set(topic, [...(groups.get(topic) ?? []), resource]);
  }
  return [...groups.entries()].map(([name, items]) => {
    const completed = items.filter((item) => item.status === "completed").length;
    const total = items.length;
    const remainingMinutes = items.filter((item) => item.status !== "completed").reduce((sum, item) => sum + (item.estimated_minutes ?? 0), 0);
    return {
      name,
      total,
      completed,
      remaining: total - completed,
      remainingMinutes,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100),
      status: completed === total ? "Complete" : completed === 0 ? "Ready to begin" : "In progress",
    };
  }).sort((a, b) => b.total - a.total);
}
