"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/lib/use-session";

type Profile = { display_name: string; default_session_minutes: number; reminder_enabled: boolean; reminder_time: string; timezone: string };
type Goal = { id: string; name: string; is_primary: boolean };

export default function SettingsPage() {
  const { user, loading: sessionLoading } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [primaryGoalId, setPrimaryGoalId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (sessionLoading || !user) return;
    let active = true;
    void (async () => {
      const supabase = createClient();
      const [profileResult, goalsResult] = await Promise.all([
        supabase.from("profiles").select("display_name, default_session_minutes, reminder_enabled, reminder_time, timezone").eq("id", user.id).maybeSingle(),
        supabase.from("goals").select("id, name, is_primary").eq("user_id", user.id).eq("active", true).order("is_primary", { ascending: false }),
      ]);
      if (!active) return;
      if (profileResult.error || goalsResult.error || !profileResult.data) setMessage(profileResult.error?.message ?? goalsResult.error?.message ?? "Settings could not be loaded. Apply migration 009 first.");
      else {
        const loadedGoals = (goalsResult.data as Goal[] | null) ?? [];
        const loadedProfile = profileResult.data as Profile;
        setProfile({ ...loadedProfile, reminder_time: loadedProfile.reminder_time.slice(0, 5), timezone: loadedProfile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone });
        setGoals(loadedGoals);
        setPrimaryGoalId(loadedGoals.find((goal) => goal.is_primary)?.id ?? loadedGoals[0]?.id ?? "");
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [sessionLoading, user]);

  async function save() {
    if (!profile || !primaryGoalId) return;
    setSaving(true);
    setMessage("");
    setSuccess(false);
    const { error } = await createClient().rpc("update_profile_settings", {
      p_display_name: profile.display_name,
      p_default_session_minutes: profile.default_session_minutes,
      p_reminder_enabled: profile.reminder_enabled,
      p_reminder_time: profile.reminder_time,
      p_timezone: profile.timezone,
      p_primary_goal_id: primaryGoalId,
    });
    setSaving(false);
    if (error) setMessage(error.message);
    else setSuccess(true);
  }

  if (sessionLoading || loading) return <main className="flex min-h-screen items-center justify-center">Loading settings…</main>;
  if (!profile) return <main className="flex min-h-screen items-center justify-center px-5"><p className="max-w-lg rounded-2xl bg-[#fbeceb] p-5 text-[#7a302a]">{message}</p></main>;

  return <main className="min-h-screen px-5 py-8 pb-28 sm:px-8 md:pb-8"><div className="mx-auto max-w-3xl"><AppHeader current="settings" /><section className="mt-12"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">Settings</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Make resurfacing fit your routine.</h1></section>
    <section className="mt-8 rounded-[2rem] border border-[var(--border)] bg-white p-6 sm:p-9"><div className="grid gap-6"><label><span className="mb-2 block text-sm font-semibold">Display name</span><input className="min-h-12 w-full rounded-2xl border border-[var(--border)] px-4" maxLength={60} onChange={(event) => setProfile({ ...profile, display_name: event.target.value })} value={profile.display_name} /></label>
      <fieldset><legend className="font-semibold">Default session duration</legend><div className="mt-3 grid grid-cols-3 gap-3">{[5, 10, 20].map((minutes) => <button aria-pressed={profile.default_session_minutes === minutes} className={`min-h-12 rounded-2xl border font-semibold ${profile.default_session_minutes === minutes ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`} key={minutes} onClick={() => setProfile({ ...profile, default_session_minutes: minutes })} type="button">{minutes} min</button>)}</div></fieldset>
      <fieldset><legend className="font-semibold">Main focus</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{goals.map((goal) => <button aria-pressed={primaryGoalId === goal.id} className={`rounded-2xl border p-4 text-left font-semibold ${primaryGoalId === goal.id ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`} key={goal.id} onClick={() => setPrimaryGoalId(goal.id)} type="button">{goal.name}</button>)}</div></fieldset>
      <div className="rounded-2xl bg-[#f2f4ee] p-5"><label className="flex items-start justify-between gap-5"><span><strong className="block">Daily resurfacing prompt</strong><small className="mt-1 block leading-5 text-[var(--muted)]">Show a reminder on the dashboard when you visit around your chosen time.</small></span><input checked={profile.reminder_enabled} className="mt-1 h-5 w-5 accent-[var(--accent)]" onChange={(event) => setProfile({ ...profile, reminder_enabled: event.target.checked })} type="checkbox" /></label>{profile.reminder_enabled && <div className="mt-5 grid gap-4 sm:grid-cols-2"><label><span className="mb-2 block text-sm font-semibold">Reminder time</span><input className="min-h-12 w-full rounded-2xl border border-[var(--border)] bg-white px-4" onChange={(event) => setProfile({ ...profile, reminder_time: event.target.value })} type="time" value={profile.reminder_time} /></label><label><span className="mb-2 block text-sm font-semibold">Timezone</span><input className="min-h-12 w-full rounded-2xl border border-[var(--border)] bg-white px-4" maxLength={80} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })} value={profile.timezone} /></label></div>}</div>
    </div>{message && <p className="mt-6 rounded-2xl bg-[#fbeceb] p-4 text-sm text-[#7a302a]">{message}</p>}{success && <p className="mt-6 rounded-2xl bg-[#e9f3e5] p-4 text-sm font-semibold text-[var(--accent)]">Settings saved.</p>}<button className="mt-7 min-h-12 rounded-full bg-[var(--accent)] px-7 font-semibold text-white disabled:opacity-60" disabled={saving || !profile.display_name.trim()} onClick={save} type="button">{saving ? "Saving…" : "Save settings"}</button></section>
  </div></main>;
}
