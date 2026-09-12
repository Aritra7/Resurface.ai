/**
 * Pulls liked videos and playlist contents into `resources`.
 * Idempotent: re-running updates existing rows rather than duplicating them.
 */
import { NextResponse } from "next/server";
import { fetchSavedVideos } from "@/lib/connectors/youtube";
import { getUsableAccessToken, type ConnectionRow } from "@/lib/connectors/tokens";
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server";
import { finishSyncRun, ingestItems, startSyncRun, type IngestItem } from "@/lib/ingest";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Playlists are the default; likes are opt-in. Body is optional, so a bare POST works.
  let includeLikes = false;
  try {
    const body = await request.json();
    includeLikes = body?.includeLikes === true;
  } catch {
    // No body, or not JSON. Keep the default.
  }

  const supabase = createServiceClient();

  // Order by newest and take the first rather than maybeSingle(): a user who reconnects
  // under a second Google account legitimately has two rows, and maybeSingle() errors on
  // more than one. That error would otherwise surface as a misleading "not connected".
  const { data: connections, error: lookupError } = await supabase
    .from("connections")
    .select("id, user_id, provider, access_token_enc, refresh_token_enc, expires_at, external_account_label")
    .eq("user_id", user.id)
    .eq("provider", "youtube")
    .order("updated_at", { ascending: false })
    .returns<ConnectionRow[]>();

  if (lookupError) {
    console.error("[youtube sync] connection lookup failed:", lookupError);
    return NextResponse.json(
      { error: `Could not read your connection: ${lookupError.message}` },
      { status: 500 },
    );
  }

  const connection = connections?.[0];
  if (!connection) {
    return NextResponse.json({ error: "YouTube is not connected" }, { status: 400 });
  }

  const runId = await startSyncRun(supabase, user.id, "youtube", connection.id);

  try {
    const accessToken = await getUsableAccessToken(supabase, connection);
    const videos = await fetchSavedVideos(accessToken, { includeLikes });

    const items: IngestItem[] = videos.map((video) => ({
      url: `https://youtube.com/watch?v=${video.videoId}`,
      source: "youtube",
      externalId: video.videoId,
      title: video.title,
      description: video.description,
      author: video.channelTitle,
      thumbnailUrl: video.thumbnailUrl,
      durationSeconds: video.durationSeconds,
      collection: video.collection,
      savedAt: video.savedAt,
    }));

    const result = await ingestItems(supabase, user.id, items, connection.id);
    await finishSyncRun(supabase, runId, result);

    await supabase
      .from("connections")
      .update({
        last_sync_at: new Date().toISOString(),
        items_count: result.inserted,
        status: "active",
        last_error: null,
      })
      .eq("id", connection.id);

    return NextResponse.json({
      ok: true,
      seen: result.seen,
      imported: result.inserted,
      skipped: result.skipped,
    });
  } catch (error) {
    const message = (error as Error).message;
    console.error("[youtube sync]", message);
    await finishSyncRun(supabase, runId, { seen: 0, inserted: 0 }, message);
    await supabase
      .from("connections")
      .update({ status: "error", last_error: message })
      .eq("id", connection.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
