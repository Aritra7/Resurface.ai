/**
 * Begins the YouTube OAuth flow.
 *
 * Generates a PKCE verifier and an anti-CSRF state, stores both in httpOnly cookies,
 * and redirects to Google. The cookies are the only place they live: they are never
 * put in a URL, a database, or client-readable storage.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { buildAuthUrl } from "@/lib/connectors/youtube";
import { getCurrentUser } from "@/lib/supabase/server";
import { isYouTubeConfigured, serverEnv } from "@/lib/env";

export async function GET(_request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", serverEnv.appUrl));
  }

  if (!isYouTubeConfigured()) {
    return NextResponse.redirect(
      new URL("/connections?error=youtube_not_configured", serverEnv.appUrl),
    );
  }

  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const response = NextResponse.redirect(buildAuthUrl(state, codeChallenge));

  const cookieOptions = {
    httpOnly: true,
    secure: serverEnv.appUrl.startsWith("https"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10 minutes is plenty for a consent screen
  };

  response.cookies.set("yt_oauth_state", state, cookieOptions);
  response.cookies.set("yt_oauth_verifier", codeVerifier, cookieOptions);

  return response;
}
