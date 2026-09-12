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
  const token = randomToken();

  // One RPC claims the code, issues the token and registers the connection. Doing the
  // check and the write separately let two concurrent requests both redeem one code.
  const { data: userId, error } = await supabase.rpc("claim_pairing_code", {
    p_code: code,
    p_token_hash: hashToken(token),
    p_label: label ?? "Chrome",
  });

  if (error) {
    console.error("[extension pair]", error);
    return NextResponse.json({ error: "Could not pair this browser." }, { status: 500 });
  }

  // A null result means unknown, already used, or expired. One message for all three,
  // so this endpoint cannot be used to probe which codes exist.
  if (!userId) {
    return NextResponse.json(
      { error: "That code is invalid or has expired. Generate a new one." },
      { status: 400 },
    );
  }

  return NextResponse.json({ token });
}
