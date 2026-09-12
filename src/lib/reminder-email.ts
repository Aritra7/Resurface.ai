import "server-only";
import { serverEnv } from "@/lib/env";

type ReminderEmail = {
  to: string;
  displayName: string;
  sessionMinutes: number;
  idempotencyKey: string;
};

export async function sendReminderEmail(input: ReminderEmail): Promise<void> {
  const apiKey = serverEnv.resendApiKey;
  const from = serverEnv.reminderFromEmail;
  if (!apiKey || !from) throw new Error("Reminder email is not configured.");

  const dashboardUrl = new URL("/dashboard", serverEnv.appUrl).toString();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
      "User-Agent": "resurface-ai/0.1",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: "A few saved ideas are ready to resurface",
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;color:#17211b">
          <p style="color:#317553;font-weight:700;letter-spacing:.08em">RESURFACE.AI</p>
          <h1 style="font-size:30px;line-height:1.2">Your saves are ready, ${escapeHtml(input.displayName)}.</h1>
          <p style="font-size:17px;line-height:1.6;color:#59635d">Take a focused ${input.sessionMinutes}-minute session and turn one forgotten bookmark into progress.</p>
          <p style="margin:30px 0"><a href="${dashboardUrl}" style="background:#317553;color:white;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700">Start resurfacing</a></p>
          <p style="font-size:13px;color:#7a817c">You can change or disable this daily reminder in Resurface settings.</p>
        </div>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}
