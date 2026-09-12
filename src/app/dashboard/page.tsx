"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeResourceCount, setActiveResourceCount] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.replace("/login");
        return;
      }

      const [profileResult, goalsResult, resourcesResult] = await Promise.all([
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

      setProfile(profileResult.data);
      setGoals(goalsResult.data ?? []);
      setActiveResourceCount(resourcesResult.count ?? 0);
      setLoading(false);
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, [router]);

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
  }

  if (loading) {
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

  const primaryGoal = goals.find((goal) => goal.is_primary);
  const otherGoals = goals.filter((goal) => !goal.is_primary);

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <Link className="text-lg font-semibold" href="/">
            Resurface<span className="text-[var(--accent)]">.AI</span>
          </Link>
          <button className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]" onClick={signOut} type="button">
            Sign out
          </button>
        </header>

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

        <section className="mt-8 rounded-[2rem] border border-dashed border-[var(--border)] bg-white/60 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">{activeResourceCount} active {activeResourceCount === 1 ? "save" : "saves"}</p>
          <h2 className="mt-2 text-2xl font-semibold">{activeResourceCount > 0 ? "Your backlog is ready for a session" : "Bring in what you already saved"}</h2>
          <p className="mx-auto mt-3 max-w-xl leading-7 text-[var(--muted)]">
            {activeResourceCount > 0
              ? "Resurface will use your confirmed resources, goal matches, and time estimates."
              : "Connect YouTube, Chrome, or Instagram to import saves you already made, with their real durations. Sample saves work too."}
          </p>
          <Link
            className="mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white transition hover:bg-[var(--accent-hover)]"
            href="/connections"
          >
            {activeResourceCount > 0 ? "Manage connections" : "Connect your accounts"}
          </Link>
        </section>
      </div>
    </main>
  );
}
