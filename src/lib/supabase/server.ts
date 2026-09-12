/**
 * Server-side Supabase clients.
 *
 * Two clients with deliberately different powers:
 *
 *   createServerClient()  - acts AS the signed-in user, RLS applies. Use for anything
 *                           the user could do themselves.
 *   createServiceClient() - bypasses RLS entirely. Use only where RLS intentionally
 *                           blocks all client access: writing connections rows, reading
 *                           extension_tokens, burning pairing_codes.
 *
 * Reaching for the service client when the user client would do is how RLS gets
 * quietly defeated, so every call site of createServiceClient should be obvious.
 */
import "server-only";
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serverEnv } from "../env";

/** Cookie-aware client bound to the caller's session. RLS applies. */
export async function createServerClient(): Promise<SupabaseClient> {
  // In Next.js 16 `cookies()` is async.
  const cookieStore = await cookies();

  return createSSRClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** Full-privilege client. Bypasses RLS. Never expose its results directly to a browser. */
export function createServiceClient(): SupabaseClient {
  return createSupabaseClient(serverEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Whether a usable server key is configured. */
export function hasServiceKey(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

/**
 * A client for writing the caller's own rows.
 *
 * Prefers the service client, but falls back to the caller's RLS-scoped session when no
 * server key is configured. That fallback is safe precisely because RLS applies: the
 * `resources own rows` policy lets a user read and write only their own resources, which
 * is all ingest ever does.
 *
 * This exists so a deployment missing SUPABASE_SECRET_KEY still imports content instead
 * of failing with "Invalid API key". It cannot rescue routes that touch connections,
 * pairing_codes or extension_tokens, where RLS intentionally denies all client access --
 * those genuinely require the server key.
 */
export async function createOwnDataClient(): Promise<SupabaseClient> {
  if (hasServiceKey()) return createServiceClient();
  return createServerClient();
}

/** The signed-in user, or null. Prefer this over getSession() — it verifies with the auth server. */
export async function getCurrentUser() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
