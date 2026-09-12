/**
 * Disconnects a provider.
 *
 * Revokes the token upstream before deleting the row. Deleting alone would leave a live
 * grant on the user's Google account that they can no longer see or manage from here.
 * Ingested resources are deliberately kept — the user's saves are theirs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { revokeToken } from "@/lib/connectors/youtube";
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Route params are async in Next.js 16.
  const { provider } = await context.params;
  if (provider !== "youtube" && provider !== "chrome") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: connection } = await supabase
    .from("connections")
    .select("id, refresh_token_enc")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle<{ id: string; refresh_token_enc: string | null }>();

  if (!connection) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  if (provider === "youtube" && connection.refresh_token_enc) {
    try {
      await revokeToken(decrypt(connection.refresh_token_enc));
    } catch (error) {
      console.warn("[disconnect] upstream revoke failed:", (error as Error).message);
    }
  }

  if (provider === "chrome") {
    await supabase.from("extension_tokens").update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id).is("revoked_at", null);
  }

  await supabase.from("connections").delete().eq("id", connection.id);
  return NextResponse.json({ ok: true });
}
