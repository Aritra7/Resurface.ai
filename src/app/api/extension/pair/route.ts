/**
 * Exchanges a pairing code for a long-lived extension token.
 *
 * Called by the extension, which has no session, so this route is intentionally
 * unauthenticated — the code itself is the credential. It is single-use, expires in
 * ten minutes, and only the SHA-256 hash of the issued token is stored.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hashToken, randomToken } from "@/lib/crypto";

export async function POST(request: Request) {
  let code: string | undefined;
  let label: string | undefined;
  try {
    const body = await request.json();
    code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : undefined;
    label = typeof body?.label === "string" ? body.label.slice(0, 100) : undefined;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  if (!code) return NextResponse.json({ error: "Enter the pairing code." }, { status: 400 });

  const supabase = createServiceClient();

  const { data: pairing } = await supabase
    .from("pairing_codes")
    .select("code, user_id, expires_at, used_at")
    .eq("code", code)
    .maybeSingle<{ code: string; user_id: string; expires_at: string; used_at: string | null }>();

  // One message for every failure mode, so this cannot be used to probe which codes exist.
  const invalid = NextResponse.json(
    { error: "That code is invalid or has expired. Generate a new one." },
    { status: 400 },
  );
  if (!pairing) return invalid;
  if (pairing.used_at) return invalid;
  if (new Date(pairing.expires_at).getTime() < Date.now()) return invalid;

  const token = randomToken();

  const { error: tokenError } = await supabase.from("extension_tokens").insert({
    user_id: pairing.user_id,
    token_hash: hashToken(token),
    label: label ?? "Chrome",
  });
  if (tokenError) {
    console.error("[extension pair]", tokenError);
    return NextResponse.json({ error: "Could not pair this browser." }, { status: 500 });
  }

  // Burn the code so it cannot be replayed.
  await supabase
    .from("pairing_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", pairing.code);

  // Register the connection so /connections can show it.
  await supabase.from("connections").upsert(
    {
      user_id: pairing.user_id,
      provider: "browser_bookmark",
      external_account_id: "chrome",
      external_account_label: label ?? "Chrome",
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,external_account_id" },
  );

  return NextResponse.json({ token });
}
