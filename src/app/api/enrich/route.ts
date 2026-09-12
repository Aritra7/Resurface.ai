/**
 * Enriches resources still marked `pending`.
 *
 * Runs after ingest rather than during it, so a slow or failing metadata fetch can never
 * cost the user their link — the row already exists before this touches it. Per
 * INGESTION_AND_CATEGORIZATION.md section 9, a failure marks `failed` and preserves the
 * link rather than deleting anything.
 */
import { NextResponse } from "next/server";
import { createServiceClient, getCurrentUser } from "@/lib/supabase/server";
import { enrichUrl } from "@/lib/enrich";

/** Bounded per request so the route cannot run unboundedly long. Call again for more. */
const BATCH_SIZE = 40;
const CONCURRENCY = 6;

type PendingRow = {
  id: string;
  url: string;
  source: string;
  title: string | null;
  content_type: string;
  estimated_minutes: number;
};

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const supabase = createServiceClient();

  const { data: pending, error } = await supabase
    .from("resources")
    .select("id, url, source, title, content_type, estimated_minutes")
    .eq("user_id", user.id)
    .eq("enrichment_status", "pending")
    .limit(BATCH_SIZE)
    .returns<PendingRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, enriched: 0, remaining: 0 });
  }

  let enriched = 0;
  let failed = 0;

  // Small worker pool: enough to be quick, not enough to look like an attack to any host.
  const queue = [...pending];
  async function worker() {
    for (;;) {
      const row = queue.shift();
      if (!row) return;

      const result = await enrichUrl(row.url, row.source);

      if (!result || (!result.title && !result.description && !result.thumbnailUrl)) {
        failed += 1;
        await supabase
          .from("resources")
          .update({ enrichment_status: "failed" })
          .eq("id", row.id);
        continue;
      }

      enriched += 1;
      await supabase
        .from("resources")
        .update({
          // Never overwrite a title we already have with a worse one.
          title: row.title ?? result.title ?? null,
          description: result.description ?? null,
          author: result.author ?? undefined,
          thumbnail_url: result.thumbnailUrl ?? null,
          enrichment_status: "complete",
        })
        .eq("id", row.id);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const { count } = await supabase
    .from("resources")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("enrichment_status", "pending");

  return NextResponse.json({
    ok: true,
    processed: pending.length,
    enriched,
    failed,
    remaining: count ?? 0,
  });
}
