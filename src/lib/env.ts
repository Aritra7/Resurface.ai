/**
 * Server-only environment access.
 *
 * Importing this module from a client component is a build error, which is the point:
 * it guarantees the secret key and OAuth client secret cannot leak into a browser bundle.
 */
import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  get tokenEncryptionKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  get appUrl() {
    return process.env.APP_URL || "http://localhost:3000";
  },
  /** Optional so the app still boots before Google credentials arrive. */
  get googleClientId() {
    return optional("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return optional("GOOGLE_CLIENT_SECRET");
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
  /** Optional until production email delivery is enabled. */
  get resendApiKey() {
    return optional("RESEND_API_KEY");
  },
  get reminderFromEmail() {
    return optional("REMINDER_FROM_EMAIL");
  },
};

/** Whether the YouTube connector is configured. Lets the UI explain itself instead of crashing. */
export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isReminderEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.REMINDER_FROM_EMAIL);
}
