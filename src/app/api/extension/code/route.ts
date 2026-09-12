/**
 * Mints a short-lived pairing code the user types into the extension popup.
 *
 * Device-pairing rather than OAuth: an MV3 service worker has no Supabase session and
 * lives on a different origin, so cookie auth is impractical. A code the user carries
 * across by hand avoids CORS and cookie scoping entirely.
 */
import { NextResponse } from "next/server";
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server";
import { randomPairingCode } from "@/lib/crypto";

const TTL_MINUTES = 10;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = createServiceClient();
  const code = randomPairingCode();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  const { error } = await supabase
    .from("pairing_codes")
    .insert({ code, user_id: user.id, expires_at: expiresAt });

  if (error) {
    console.error("[extension code]", error);
    return NextResponse.json({ error: "Could not create a pairing code." }, { status: 500 });
  }

  return NextResponse.json({ code, expiresAt, expiresInMinutes: TTL_MINUTES });
}
