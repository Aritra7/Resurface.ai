/**
 * Completes the YouTube OAuth flow.
 *
 * Verifies state against the cookie, exchanges the code with the PKCE verifier, encrypts
 * both tokens, and writes a connections row. Tokens never touch the browser.
 */
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, fetchChannelIdentity, YOUTUBE_SCOPES } from "@/lib/connectors/youtube";
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";

function fail(reason: string) {
  return NextResponse.redirect(new URL(`/connections?error=${reason}`, serverEnv.appUrl));
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", serverEnv.appUrl));

  const params = request.nextUrl.searchParams;

  // Google returns access_denied both when the user declines AND when the app is in
  // Testing mode and they are not a listed test user. Those need different advice, so
  // pass the distinction through rather than collapsing both into "you cancelled".
  const googleError = params.get("error");
  if (googleError) {
    const detail = params.get("error_subtype") ?? params.get("error_description") ?? "";
    console.warn("[youtube callback] google error:", googleError, detail);
    if (googleError === "access_denied" && /test|verif|block/i.test(detail)) {
      return fail("not_a_test_user");
    }
    return fail(googleError === "access_denied" ? "access_denied" : "oauth_error");
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get("yt_oauth_state")?.value;
  const codeVerifier = request.cookies.get("yt_oauth_verifier")?.value;

  if (!code || !state || !expectedState || !codeVerifier) return fail("missing_oauth_params");
  if (state !== expectedState) return fail("state_mismatch");

  let tokens;
  try {
    tokens = await exchangeCode(code, codeVerifier);
  } catch (error) {
    console.error("[youtube callback] token exchange:", error);
    return fail("token_exchange_failed");
  }

  // Without a refresh token the connection dies in an hour. Surface it rather than
  // storing a connection that will silently stop working.
  if (!tokens.refresh_token) return fail("no_refresh_token");

  // Google presents YouTube access as an OPTIONAL checkbox on the consent screen. If the
  // user leaves it unticked, Google still issues a perfectly valid token — just without
  // youtube.readonly. Storing that produces a connection that looks healthy and then
  // fails every sync with a 403 the user cannot interpret. Check at the door instead.
  const grantedScopes = tokens.scope?.split(" ") ?? [];
  if (!grantedScopes.some((scope) => scope.includes("youtube"))) {
    return fail("youtube_scope_missing");
  }

  const identity = await fetchChannelIdentity(tokens.access_token);
  const supabase = createServiceClient();

  const { error } = await supabase.from("connections").upsert(
    {
      user_id: user.id,
      provider: "youtube",
      external_account_id: identity.id ?? user.id,
      external_account_label: identity.label ?? "YouTube account",
      access_token_enc: encrypt(tokens.access_token),
      refresh_token_enc: encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope?.split(" ") ?? YOUTUBE_SCOPES,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,external_account_id" },
  );

  if (error) {
    console.error("[youtube callback] connection upsert:", error);
    return fail("connection_save_failed");
  }

  const response = NextResponse.redirect(
    new URL("/connections?connected=youtube", serverEnv.appUrl),
  );
  response.cookies.delete("yt_oauth_state");
  response.cookies.delete("yt_oauth_verifier");
  return response;
}
