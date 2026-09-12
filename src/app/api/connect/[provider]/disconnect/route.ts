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
  if (provider !== "youtube" && provider !== "browser_bookmark") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Not maybeSingle(): OAuth allows a user to connect two Google accounts, and sync
  // deliberately picks the newest. maybeSingle() errors on more than one row, and that
  // error was discarded — so disconnect reported success while deleting nothing.
  const { data: connections, error: lookupError } = await supabase
    .from("connections")
    .select("id, refresh_token_enc")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .returns<Array<{ id: string; refresh_token_enc: string | null }>>();

  if (lookupError) {
    console.error("[disconnect] lookup failed:", lookupError);
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (!connections || connections.length === 0) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  // Revoke every token upstream, not just one, or a second grant survives invisibly.
  if (provider === "youtube") {
    for (const connection of connections) {
      if (!connection.refresh_token_enc) continue;
      try {
        await revokeToken(decrypt(connection.refresh_token_enc));
      } catch (error) {
        console.warn("[disconnect] upstream revoke failed:", (error as Error).message);
      }
    }
  }

  if (provider === "browser_bookmark") {
    await supabase.from("extension_tokens").update({ revoked_at: new Date().toISOString() })
      .eq("user_id", user.id).is("revoked_at", null);
  }

  await supabase
    .from("connections")
    .delete()
    .in("id", connections.map((connection) => connection.id));

  return NextResponse.json({ ok: true, disconnected: connections.length });
}
