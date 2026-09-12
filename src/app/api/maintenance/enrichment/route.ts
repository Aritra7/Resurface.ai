import { NextResponse } from "next/server";
import { enrichUrl } from "@/lib/enrich";
import { serverEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

const BATCH_SIZE = 40;
type PendingResource = { id: string; url: string; source: string; title: string | null };

async function run(request: Request) {
  const configuredSecret = serverEnv.cronSecret;
  const suppliedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configuredSecret || suppliedSecret !== configuredSecret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("resources").select("id, url, source, title").eq("enrichment_status", "pending").limit(BATCH_SIZE).returns<PendingResource[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let enriched = 0;
  let failed = 0;
  for (const resource of data ?? []) {
    const result = await enrichUrl(resource.url, resource.source);
    if (!result || (!result.title && !result.description && !result.thumbnailUrl)) {
      failed += 1;
      await supabase.from("resources").update({ enrichment_status: "failed" }).eq("id", resource.id);
      continue;
    }
    const updateResult = await supabase.from("resources").update({
      title: resource.title ?? result.title ?? null,
      description: result.description ?? null,
      author: result.author ?? undefined,
      thumbnail_url: result.thumbnailUrl ?? null,
      enrichment_status: "complete",
    }).eq("id", resource.id);
    if (updateResult.error) failed += 1;
    else enriched += 1;
  }

  return NextResponse.json({ ok: true, processed: data?.length ?? 0, enriched, failed });
}

// Vercel Cron invokes GET. POST stays available for local/manual runs.
export const GET = run;
export const POST = run;
