"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";
import { AppHeader } from "@/components/app-header";
import { listStoredSessions } from "@/features/sessions/local-session-store";
import { isReminderDue, reminderDateKey } from "@/features/reminders/due";

type Profile = {
  display_name: string;
  default_session_minutes: number;
  onboarding_completed: boolean;
  reminder_enabled: boolean;
  reminder_time: string;
  timezone: string;
};

type Goal = {
  id: string;
  name: string;
  is_primary: boolean;
};

type ConnectionStatus = {
  provider: string;
  external_account_label: string | null;
  status: string;
  last_sync_at: string | null;
};

type RecentResource = {
  id: string;
  title: string | null;
  source: string;
  content_type: string;
  categories: string[];
  estimated_minutes: number;
  enrichment_status: string;
};

type ProgressResource = { status: string; estimated_minutes: number };
type RecentSession = { id: string; time_budget_minutes: number; energy_mode: string; started_at: string; completed_at: string | null };

/** Human labels for the providers, so the UI never prints a raw enum value. */
const PROVIDER_LABEL: Record<string, string> = {
  youtube: "YouTube",
  browser_bookmark: "Chrome",
  instagram: "Instagram",
};

export default function DashboardPage() {
  const router = useRouter();
  // Keeps the page in step with token refreshes and sign-outs in other tabs, instead of
  // checking auth once and redirecting the moment a refresh lands.
  const { user, loading: sessionLoading } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeResourceCount, setActiveResourceCount] = useState(0);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [recentResources, setRecentResources] = useState<RecentResource[]>([]);
  const [progressResources, setProgressResources] = useState<ProgressResource[]>([]);
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [localSessionIds, setLocalSessionIds] = useState<string[]>([]);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (sessionLoading) return;
    if (!user) return; // useSession already redirected.

    async function loadDashboard() {
      const supabase = createClient();
      const authData = { user: user! };

      const [profileResult, goalsResult, resourcesResult, connectionsResult, sourcesResult, recentResult, progressResult, sessionsResult] =
        await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, default_session_minutes, onboarding_completed, reminder_enabled, reminder_time, timezone")
          .eq("id", authData.user.id)
          .maybeSingle(),
        supabase
          .from("goals")
          .select("id, name, is_primary")
          .eq("user_id", authData.user.id)
          .eq("active", true)
          .order("is_primary", { ascending: false }),
        supabase
          .from("resources")
          .select("id", { count: "exact", head: true })
          .eq("user_id", authData.user.id)
          .eq("status", "active"),
        // connection_status is the view that excludes every token column, so nothing
        // sensitive can reach the browser even by accident.
        supabase
          .from("connection_status")
          .select("provider, external_account_label, status, last_sync_at")
          .eq("user_id", authData.user.id),
        supabase
          .from("resources")
          .select("source")
          .eq("user_id", authData.user.id)
          .eq("status", "active"),
        supabase
          .from("resources")
          .select("id, title, source, content_type, categories, estimated_minutes, enrichment_status")
          .eq("user_id", authData.user.id)
          .order("saved_at", { ascending: false })
          .limit(6),
        supabase
          .from("resources")
          .select("status, estimated_minutes")
          .eq("user_id", authData.user.id)
          .neq("status", "unavailable"),
        supabase
          .from("sessions")
          .select("id, time_budget_minutes, energy_mode, started_at, completed_at")
          .eq("user_id", authData.user.id)
          .order("started_at", { ascending: false })
          .limit(4),
      ]);

      if (!active) return;

      if (profileResult.error || goalsResult.error) {
        setError(profileResult.error?.message ?? goalsResult.error?.message ?? "Could not load your profile.");
        setLoading(false);
        return;
      }

      if (!profileResult.data?.onboarding_completed) {
        router.replace("/onboarding");
        return;
      }

      const counts: Record<string, number> = {};
      for (const row of sourcesResult.data ?? []) {
        const source = (row as { source: string }).source;
        counts[source] = (counts[source] ?? 0) + 1;
      }

      setProfile(profileResult.data);
      setGoals(goalsResult.data ?? []);
      setActiveResourceCount(resourcesResult.count ?? 0);
      setConnections(connectionsResult.data ?? []);
      setSourceCounts(counts);
      setRecentResources((recentResult.data as RecentResource[] | null) ?? []);
      setProgressResources((progressResult.data as ProgressResource[] | null) ?? []);
      setRecentSessions((sessionsResult.data as RecentSession[] | null) ?? []);
      setLocalSessionIds(listStoredSessions().map((session) => session.id));
      if (!window.localStorage.getItem("resurface-dashboard-tour-complete")) setTourOpen(true);
      setReminderDismissed(window.localStorage.getItem(`resurface-reminder-dismissed:${reminderDateKey(profileResult.data.timezone)}`) === "true");
      setLoading(false);
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, [router, user, sessionLoading]);


  if (sessionLoading || loading) {
    return <main className="flex min-h-screen items-center justify-center">Loading your dashboard…</main>;
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5">
        <section className="max-w-lg rounded-3xl border border-[var(--border)] bg-white p-8 text-center">
          <h1 className="text-2xl font-semibold">We could not load your profile.</h1>
          <p className="mt-3 text-[var(--muted)]">{error}</p>
          <Link className="mt-6 inline-flex rounded-full bg-[var(--accent)] px-5 py-3 font-semibold text-white" href="/onboarding">
            Return to setup
          </Link>
        </section>
      </main>
    );
  }

  /**
   * Instagram is a file import and deliberately has no `connections` row, so a list
   * built only from connections omits it entirely. Merge both shapes into one view
   * model: every source the user actually has saves from gets a card.
   */
  const sources = [
    ...connections.map((connection) => ({
      provider: connection.provider,
      count: sourceCounts[connection.provider] ?? 0,
      label: connection.external_account_label ?? "Connected",
      lastSyncAt: connection.last_sync_at as string | null,
      broken: connection.status === "error" || connection.status === "expired",
    })),
    ...((sourceCounts.instagram ?? 0) > 0 &&
    !connections.some((connection) => connection.provider === "instagram")
      ? [
          {
            provider: "instagram",
            count: sourceCounts.instagram,
            label: "Imported from your export",
            lastSyncAt: null as string | null,
            broken: false,
          },
        ]
      : []),
  ];

  const primaryGoal = goals.find((goal) => goal.is_primary);
  const otherGoals = goals.filter((goal) => !goal.is_primary);
  const trackableResources = progressResources.filter((resource) => resource.status !== "archived");
  const completedResources = trackableResources.filter((resource) => resource.status === "completed");
  const completionPercent = trackableResources.length
    ? Math.round((completedResources.length / trackableResources.length) * 100)
    : 0;
  const investedMinutes = completedResources.reduce((total, resource) => total + resource.estimated_minutes, 0);
  const activeSession = recentSessions.find((session) => !session.completed_at && localSessionIds.includes(session.id));

  function closeTour() {
    window.localStorage.setItem("resurface-dashboard-tour-complete", "true");
    setTourOpen(false);
    setTourStep(0);
  }

  function dismissReminder() {
    window.localStorage.setItem(`resurface-reminder-dismissed:${reminderDateKey(profile?.timezone ?? "UTC")}`, "true");
    setReminderDismissed(true);
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <AppHeader current="dashboard" />

        <section className="mt-14">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Your resurfacing plan</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Hey {profile?.display_name}, your setup is ready.</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            We will build short revisit sessions around your goals, starting with {profile?.default_session_minutes} minutes at a time.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href="/session/new">
              Start a session
            </Link>
            <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--accent)] bg-white px-6 font-semibold text-[var(--accent)]" href="/add">
              Add a save
            </Link>
            <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] bg-white px-6 font-semibold" href="/demo">
              Preview sample saves
            </Link>
            <button className="min-h-12 rounded-full px-5 text-sm font-semibold text-[var(--muted)]" onClick={() => { setTourStep(0); setTourOpen(true); }} type="button">How it works</button>
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-7 shadow-[0_20px_60px_rgba(40,65,46,0.07)]">
            <p className="text-sm font-medium text-[var(--muted)]">Main focus</p>
            <h2 className="mt-3 text-3xl font-semibold">{primaryGoal?.name ?? "Your top goal"}</h2>
            <p className="mt-3 leading-7 text-[var(--muted)]">
              Saves related to this goal receive the strongest relevance boost when your time is limited.
            </p>
            {otherGoals.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {otherGoals.map((goal) => (
                  <span className="rounded-full bg-[#edf0e8] px-3 py-1.5 text-sm" key={goal.id}>{goal.name}</span>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-[2rem] bg-[var(--accent)] p-7 text-white">
            <p className="text-sm font-medium text-white/70">Default session</p>
            <p className="mt-2 text-5xl font-semibold">{profile?.default_session_minutes}</p>
            <p className="mt-1 text-white/80">minutes</p>
            <p className="mt-6 text-sm leading-6 text-white/75">You will be able to change the time whenever you start a session.</p>
          </article>
        </section>

        {profile && activeResourceCount > 0 && profile.reminder_enabled && isReminderDue(profile.reminder_time, profile.timezone) && !reminderDismissed && (
          <section className="mt-8 flex flex-col justify-between gap-5 rounded-[2rem] border border-[#b8d9ad] bg-[#edf8e9] p-6 sm:flex-row sm:items-center sm:p-7">
            <div><p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Today’s resurfacing prompt</p><h2 className="mt-2 text-2xl font-semibold">A few saved ideas are ready for you.</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Your preferred reminder time is {profile.reminder_time.slice(0, 5)}. Start with your default {profile.default_session_minutes}-minute session.</p></div>
            <div className="flex shrink-0 gap-3"><button className="rounded-full px-4 py-3 text-sm font-semibold text-[var(--muted)]" onClick={dismissReminder} type="button">Not today</button><Link className="inline-flex items-center rounded-full bg-[var(--accent)] px-5 py-3 font-semibold text-white" href={`/session/new?minutes=${profile.default_session_minutes}`}>Start now →</Link></div>
          </section>
        )}

        <section className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[2rem] bg-[var(--accent)] p-7 text-white shadow-[0_24px_60px_rgba(47,111,78,0.18)]">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">{activeSession ? "Continue where you stopped" : "Your next best action"}</p>
            <h2 className="mt-3 text-3xl font-semibold">{activeSession ? `Resume your ${activeSession.time_budget_minutes}-minute session.` : "Turn a few saved links into progress."}</h2>
            <p className="mt-3 max-w-xl leading-7 text-white/75">{activeSession ? "Your unfinished queue is still available on this device." : "Choose your time and energy, preview the optimizer’s choices, then adjust the queue before starting."}</p>
            <Link className="mt-6 inline-flex min-h-12 items-center rounded-full bg-white px-6 font-semibold text-[var(--accent)]" href={activeSession ? `/session/${activeSession.id}` : "/session/new"}>{activeSession ? "Resume session" : "Build a session"} →</Link>
          </article>
          <article className="rounded-[2rem] border border-[var(--border)] bg-white p-7">
            <div className="flex items-end justify-between"><div><p className="text-sm text-[var(--muted)]">Your progress</p><h2 className="mt-1 text-2xl font-semibold">{completionPercent}% revisited</h2></div><Link className="text-sm font-semibold text-[var(--accent)]" href="/progress">Details →</Link></div>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#e8ede5]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${completionPercent}%` }} /></div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center"><DashboardStat label="done" value={completedResources.length} /><DashboardStat label="remaining" value={Math.max(0, trackableResources.length - completedResources.length)} /><DashboardStat label="minutes" value={investedMinutes} /></div>
          </article>
        </section>

        <section className="mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
                Connected sources
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                {activeResourceCount} {activeResourceCount === 1 ? "save" : "saves"} ready
              </h2>
            </div>
            <Link
              className="text-sm font-medium text-[var(--accent)] hover:underline"
              href="/connections"
            >
              Manage connections
            </Link>
          </div>

          {sources.length > 0 ? (
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {sources.map((source) => (
                <li className="rounded-2xl border border-[var(--border)] p-4" key={source.provider}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{PROVIDER_LABEL[source.provider] ?? source.provider}</p>
                    <span
                      aria-label={source.broken ? "Needs attention" : "Connected"}
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        source.broken ? "bg-[#9b4444]" : "bg-[var(--accent)]"
                      }`}
                    />
                  </div>
                  <p className="mt-2 text-2xl font-semibold">{source.count}</p>
                  <p className="text-sm text-[var(--muted)]">{source.label}</p>
                  {source.lastSyncAt && (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Synced {new Date(source.lastSyncAt).toLocaleDateString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 leading-7 text-[var(--muted)]">
              Nothing connected yet. Bring in saves from YouTube, Chrome, or Instagram so your
              first session has something to choose from.
            </p>
          )}

          {activeResourceCount === 0 && (
            <Link
              className="mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)]"
              href="/connections"
            >
              Connect your accounts
            </Link>
          )}
        </section>

        {recentResources.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Recently saved</h2>
              <Link className="text-sm font-medium text-[var(--accent)] hover:underline" href="/add">
                Add another
              </Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {recentResources.map((resource) => (
                <article className="rounded-2xl border border-[var(--border)] bg-white p-5" key={resource.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-6">{resource.title?.trim() || "Untitled save"}</p>
                    {resource.enrichment_status === "failed" && (
                      <span className="shrink-0 rounded-full bg-[#fbeceb] px-2 py-0.5 text-xs font-semibold text-[#8a3a33]">
                        Needs details
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm capitalize text-[var(--muted)]">
                    {resource.source.replace("_", " ")} · {resource.content_type.replace("_", " ")} · {resource.estimated_minutes} min
                  </p>
                  {resource.categories.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {resource.categories.map((category) => (
                        <span className="rounded-full bg-[#edf0e8] px-2.5 py-1 text-xs font-medium" key={category}>
                          {category}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {recentSessions.length > 0 && (
          <section className="mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-7">
            <div className="flex items-center justify-between"><div><p className="text-sm text-[var(--muted)]">Recent sessions</p><h2 className="mt-1 text-2xl font-semibold">Keep the thread visible</h2></div><Link className="text-sm font-semibold text-[var(--accent)]" href="/progress">View progress</Link></div>
            <div className="mt-5 divide-y divide-[var(--border)]">{recentSessions.map((session) => <div className="flex items-center justify-between gap-4 py-4" key={session.id}><div><strong>{session.time_budget_minutes}-minute {session.energy_mode} session</strong><p className="mt-1 text-xs text-[var(--muted)]">{new Date(session.started_at).toLocaleDateString()}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${session.completed_at ? "bg-[#e9f3e5] text-[var(--accent)]" : "bg-[#fff0c9] text-[#7d5b17]"}`}>{session.completed_at ? "Complete" : "In progress"}</span></div>)}</div>
          </section>
        )}
      </div>
      {tourOpen && <DashboardTour onClose={closeTour} onStepChange={setTourStep} step={tourStep} />}
    </main>
  );
}

function DashboardStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-[#f2f4ee] p-3"><strong className="block text-2xl text-[var(--accent)]">{value}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{label}</span></div>;
}

const TOUR_STEPS = [
  { kicker: "YOUR LIBRARY", title: "Bring every save into one place.", copy: "Add links manually or import from YouTube, Instagram exports, and the browser extension. Categories and goals keep the backlog understandable." },
  { kicker: "YOUR OPTIMIZER", title: "Choose what fits right now.", copy: "Tell Resurface your priority, available time, and energy. Preview the finite queue and replace anything that does not feel useful." },
  { kicker: "YOUR FEEDBACK", title: "Every decision changes what comes next.", copy: "Complete, snooze, archive, or skip resources. Your Path and Progress views update from those real outcomes." },
] as const;

function DashboardTour({ onClose, onStepChange, step }: { onClose: () => void; onStepChange: (step: number) => void; step: number }) {
  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  return <div aria-label="Resurface walkthrough" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-5" role="dialog"><section className="w-full max-w-md rounded-[2rem] bg-white p-7 shadow-2xl"><div className="flex justify-between gap-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">{current.kicker}</p><button className="text-sm text-[var(--muted)]" onClick={onClose} type="button">Skip</button></div><h2 className="mt-4 text-3xl font-semibold tracking-tight">{current.title}</h2><p className="mt-3 leading-7 text-[var(--muted)]">{current.copy}</p><div className="mt-7 flex items-center justify-between gap-4"><div className="flex gap-2" aria-label={`Step ${step + 1} of ${TOUR_STEPS.length}`}>{TOUR_STEPS.map((item, index) => <span className={`h-2 w-2 rounded-full ${index === step ? "bg-[var(--accent)]" : "bg-[#dce5d8]"}`} key={item.kicker} />)}</div><button className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white" onClick={() => last ? onClose() : onStepChange(step + 1)} type="button">{last ? "Start resurfacing" : "Next"} →</button></div></section></div>;
}
