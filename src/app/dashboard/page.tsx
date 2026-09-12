"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";
import { AppHeader } from "@/components/app-header";

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

type ConnectionStatus = {
  provider: string;
  external_account_label: string | null;
  status: string;
  last_sync_at: string | null;
};

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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    if (sessionLoading) return;
    if (!user) return; // useSession already redirected.

    async function loadDashboard() {
      const supabase = createClient();
      const authData = { user: user! };

      const [profileResult, goalsResult, resourcesResult, connectionsResult, sourcesResult] =
        await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, default_session_minutes, onboarding_completed")
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
            <Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[var(--border)] bg-white px-6 font-semibold" href="/demo">
              Preview sample saves
            </Link>
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
      </div>
    </main>
  );
}
