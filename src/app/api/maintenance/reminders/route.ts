import { NextResponse } from "next/server";
import { isReminderDue, reminderDateKey } from "@/features/reminders/due";
import { isReminderEmailConfigured, serverEnv } from "@/lib/env";
import { sendReminderEmail } from "@/lib/reminder-email";
import { createServiceClient } from "@/lib/supabase/server";

type ReminderProfile = {
  id: string;
  display_name: string;
  default_session_minutes: number;
  reminder_time: string;
  timezone: string;
  last_reminder_at: string | null;
};

async function run(request: Request) {
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!serverEnv.cronSecret || suppliedSecret !== serverEnv.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isReminderEmailConfigured()) {
    return NextResponse.json({ error: "Reminder email is not configured." }, { status: 503 });
  }

  const now = new Date();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, default_session_minutes, reminder_time, timezone, last_reminder_at")
    .eq("reminder_enabled", true)
    .returns<ReminderProfile[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const profile of data ?? []) {
    const today = reminderDateKey(profile.timezone, now);
    const alreadySent = profile.last_reminder_at
      ? reminderDateKey(profile.timezone, new Date(profile.last_reminder_at)) === today
      : false;
    if (alreadySent || !isReminderDue(profile.reminder_time, profile.timezone, now)) {
      skipped += 1;
      continue;
    }

    const { count, error: resourceError } = await supabase
      .from("resources")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("status", "active");
    if (resourceError || !count) {
      skipped += 1;
      if (resourceError) failures.push(`${profile.id}: ${resourceError.message}`);
      continue;
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.id);
    if (userError || !userData.user.email) {
      skipped += 1;
      failures.push(`${profile.id}: ${userError?.message ?? "No email address"}`);
      continue;
    }

    try {
      await sendReminderEmail({
        to: userData.user.email,
        displayName: profile.display_name,
        sessionMinutes: profile.default_session_minutes,
        idempotencyKey: `resurface-reminder-${profile.id}-${today}`,
      });
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ last_reminder_at: now.toISOString() })
        .eq("id", profile.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (sendError) {
      failures.push(`${profile.id}: ${sendError instanceof Error ? sendError.message : "Delivery failed"}`);
    }
  }

  return NextResponse.json({ ok: failures.length === 0, checked: data?.length ?? 0, sent, skipped, failures });
}

export const GET = run;
export const POST = run;
