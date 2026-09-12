/**
 * Receives bookmarks and open tabs from the browser extension.
 *
 * Authenticated by the opaque bearer token issued at pairing, not a Supabase session,
 * because an MV3 service worker has neither cookies nor a session. CORS is open here
 * for that same reason: the caller is an extension origin, and the bearer token — not
 * the origin — is what grants access.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/crypto";
import { finishSyncRun, ingestItems, startSyncRun, type IngestItem } from "@/lib/ingest";

const Item = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  externalId: z.string().optional(),
  folder: z.string().optional(),
  savedAt: z.string().optional(),
  kind: z.enum(["bookmark", "tab"]).default("bookmark"),
});

const Payload = z.object({
  items: z.array(Item).max(2000),
  label: z.string().optional(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!token) {
    return NextResponse.json({ error: "Missing extension token." }, { status: 401, headers: CORS });
  }

  const supabase = createServiceClient();

  // Look up by hash; the raw token is never stored.
  const { data: row } = await supabase
    .from("extension_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle<{ id: string; user_id: string; revoked_at: string | null }>();

  if (!row || row.revoked_at) {
    return NextResponse.json(
      { error: "This browser is no longer paired. Reconnect from Resurface." },
      { status: 401, headers: CORS },
    );
  }

  const parsed = Payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400, headers: CORS });
  }

  const runId = await startSyncRun(supabase, row.user_id, "browser_bookmark");

  try {
    const items: IngestItem[] = parsed.data.items.map((item) => ({
      url: item.url,
      source: "browser_bookmark",
      // Bookmark node ids are stable per browser profile; tabs have none, so fall back
      // to the URL and let canonicalization dedupe.
      externalId: item.externalId,
      title: item.title,
      collection: item.folder ?? (item.kind === "tab" ? "Open tabs" : "Bookmarks"),
      savedAt: item.savedAt,
    }));

    const result = await ingestItems(supabase, row.user_id, items);
    await finishSyncRun(supabase, runId, result);

    await supabase
      .from("extension_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id);

    await supabase
      .from("connections")
      .update({
        last_sync_at: new Date().toISOString(),
        items_count: result.inserted,
        status: "active",
      })
      .eq("user_id", row.user_id)
      .eq("provider", "browser_bookmark");

    return NextResponse.json(
      { ok: true, seen: result.seen, imported: result.inserted, skipped: result.skipped },
      { headers: CORS },
    );
  } catch (error) {
    const message = (error as Error).message;
    console.error("[extension items]", message);
    await finishSyncRun(supabase, runId, { seen: 0, inserted: 0 }, message);
    return NextResponse.json({ error: message }, { status: 500, headers: CORS });
  }
}
