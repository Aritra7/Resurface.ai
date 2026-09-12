/**
 * Connection state for the /connections page.
 *
 * Reads `connection_status`, the view that deliberately excludes every token column,
 * so nothing sensitive can reach the browser even by accident. Per-source resource
 * counts come from `resources` under the caller's own RLS.
 */
import { NextResponse } from "next/server";
import { createServerClient, getCurrentUser } from "@/lib/supabase/server";
import { isYouTubeConfigured } from "@/lib/env";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = await createServerClient();

  const [{ data: connections }, { data: resources }, { data: runs }] = await Promise.all([
    supabase
      .from("connection_status")
      .select("id, provider, external_account_label, status, last_sync_at, items_count, last_error"),
    supabase.from("resources").select("source, enrichment_status, thumbnail_url").eq("user_id", user.id),
    supabase
      .from("sync_runs")
      .select("provider, status, items_upserted, finished_at, error")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(5),
  ]);

  const pendingEnrichment = (resources ?? []).filter(
    (row) => (row as { enrichment_status?: string }).enrichment_status === "pending",
  ).length;

  const counts: Record<string, number> = {};
  for (const row of resources ?? []) {
    const source = (row as { source: string }).source;
    counts[source] = (counts[source] ?? 0) + 1;
  }

  // Instagram has no connections row by design, so the UI needs its own numbers.
  const instagramEnriched = (resources ?? []).filter(
    (row) =>
      (row as { source?: string }).source === "instagram" &&
      (row as { enrichment_status?: string }).enrichment_status === "complete",
  ).length;

  return NextResponse.json({
    connections: connections ?? [],
    instagramEnriched,
    counts,
    totalResources: resources?.length ?? 0,
    pendingEnrichment,
    recentRuns: runs ?? [],
    youtubeConfigured: isYouTubeConfigured(),
  });
}
