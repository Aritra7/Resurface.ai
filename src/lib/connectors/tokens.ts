/**
 * Access-token lifecycle for stored connections.
 *
 * Google access tokens last an hour; refresh tokens last until revoked. This returns a
 * usable access token, refreshing and re-persisting transparently when the stored one
 * has expired, so callers never think about expiry.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "../crypto";
import { refreshAccessToken } from "./youtube";

export type ConnectionRow = {
  id: string;
  user_id: string;
  provider: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  external_account_label: string | null;
};

/** Refresh a minute early so a long sync cannot expire mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

export async function getUsableAccessToken(
  supabase: SupabaseClient,
  connection: ConnectionRow,
): Promise<string> {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  const stillValid = expiresAt - EXPIRY_SKEW_MS > Date.now();

  if (stillValid && connection.access_token_enc) {
    return decrypt(connection.access_token_enc);
  }

  if (!connection.refresh_token_enc) {
    throw new Error("This connection has no refresh token. Reconnect the account.");
  }

  let refreshed;
  try {
    refreshed = await refreshAccessToken(decrypt(connection.refresh_token_enc));
  } catch (error) {
    // A revoked or expired refresh token is terminal: mark it so the UI can prompt a reconnect.
    await supabase
      .from("connections")
      .update({ status: "expired", last_error: (error as Error).message })
      .eq("id", connection.id);
    throw error;
  }

  await supabase
    .from("connections")
    .update({
      access_token_enc: encrypt(refreshed.access_token),
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      status: "active",
      last_error: null,
      // Google usually omits refresh_token on refresh; keep the existing one when it does.
      ...(refreshed.refresh_token
        ? { refresh_token_enc: encrypt(refreshed.refresh_token) }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  return refreshed.access_token;
}
