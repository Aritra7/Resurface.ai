/**
 * Ingestion: turn platform-specific items into rows in the existing `resources` table.
 *
 * Deliberately writes to `resources` rather than a parallel table, so the optimizer has
 * exactly one place to read from. Two unique indexes cooperate here:
 *
 *   (user_id, source, external_id)  - re-running a sync updates rather than duplicates
 *   (user_id, canonical_url)        - the same URL from different sources collapses
 *
 * The second is why a video both liked on YouTube and bookmarked in Chrome becomes one row.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalize, hostnameOf } from "./canonical";

/**
 * Vocabulary fixed by INGESTION_AND_CATEGORIZATION.md section 6.
 * Chrome bookmarks are `browser_bookmark`, not `chrome`.
 */
export type ResourceSource =
  | "instagram"
  | "youtube"
  | "gmail"
  | "browser_bookmark"
  | "web";

export type ResourceContentType =
  | "short_video"
  | "video"
  | "social_post"
  | "article"
  | "newsletter"
  | "other";

export type IngestItem = {
  url: string;
  source: ResourceSource;
  externalId?: string;
  title?: string;
  description?: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  collection?: string;
  savedAt?: string;
  contentType?: ResourceContentType;
  /** Content type implied by the URL shape, supplied by canonicalize(). */
  contentHint?: string;
};

export type IngestResult = {
  seen: number;
  inserted: number;
  skipped: number;
};

/**
 * Content type per INGESTION_AND_CATEGORIZATION.md 5.1 and 5.2.
 *
 * Instagram splits on URL shape (/reel/ is short_video, /p/ is social_post), so the
 * hint derived during canonicalization outranks any source-level default.
 */
function inferContentType(item: IngestItem, contentHint?: string): ResourceContentType {
  if (item.contentType) return item.contentType;
  if (contentHint) return contentHint as ResourceContentType;

  if (item.source === "instagram") return "short_video";
  if (item.source === "youtube") {
    // Contract 5.2: Shorts are short_video, everything else is video.
    if (item.durationSeconds && item.durationSeconds > 0 && item.durationSeconds <= 90) {
      return "short_video";
    }
    return "video";
  }
  return "article";
}

/**
 * Estimated minutes drives the whole optimizer, so never leave it null.
 * Real duration when we have it; a documented type default when we do not.
 */
function estimateMinutes(item: IngestItem, contentType: ResourceContentType): number {
  if (item.durationSeconds && item.durationSeconds > 0) {
    // Contract 5.2: whole minutes, minimum one. Ceil rather than round, because
    // under-estimating duration overfills a time-budgeted session.
    return Math.max(1, Math.ceil(item.durationSeconds / 60));
  }
  if (contentType === "short_video") return 1; // contract 5.1 Reel default
  if (contentType === "social_post") return 1;
  if (contentType === "video") return 8;
  return 5; // article default, per MVP_SCOPE
}

/**
 * Upserts a batch. Returns counts for the sync_runs row.
 *
 * Uses the service client because sync runs server-side on the user's behalf and
 * writes connection_id, which RLS blocks from the browser.
 */
export async function ingestItems(
  supabase: SupabaseClient,
  userId: string,
  items: IngestItem[],
  connectionId?: string,
): Promise<IngestResult> {
  if (items.length === 0) return { seen: 0, inserted: 0, skipped: 0 };

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  // Collapse duplicates inside this batch before hitting the database, otherwise
  // ON CONFLICT fires twice for the same key in one statement and Postgres errors.
  const seenKeys = new Set<string>();

  for (const item of items) {
    const canonical = canonicalize(item.url);
    if (!canonical) {
      skipped += 1;
      continue;
    }

    const externalId = item.externalId ?? canonical.externalId ?? canonical.canonicalUrl;
    const key = `${item.source}::${externalId}`;
    if (seenKeys.has(key)) {
      skipped += 1;
      continue;
    }
    seenKeys.add(key);

    const contentType = inferContentType(item, item.contentHint ?? canonical.contentHint);

    rows.push({
      user_id: userId,
      url: item.url,
      canonical_url: canonical.canonicalUrl,
      source: item.source,
      external_id: externalId,
      content_type: contentType,
      title: item.title?.slice(0, 500) ?? null,
      description: item.description?.slice(0, 4000) ?? null,
      author: item.author?.slice(0, 200) ?? hostnameOf(item.url) ?? null,
      thumbnail_url: item.thumbnailUrl ?? null,
      collection: item.collection?.slice(0, 200) ?? null,
      estimated_minutes: estimateMinutes(item, contentType),
      saved_at: item.savedAt ?? new Date().toISOString(),
      enrichment_status: item.title ? "complete" : "pending",
      connection_id: connectionId ?? null,
    });
  }

  if (rows.length === 0) return { seen: items.length, inserted: 0, skipped };

  // Chunked so a large first sync does not exceed request limits.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { data, error } = await supabase
      .from("resources")
      .upsert(chunk, {
        onConflict: "user_id,source,external_id",
        ignoreDuplicates: false,
      })
      .select("id");

    if (error) {
      // The canonical_url unique index can still reject a row whose URL already
      // arrived from another source. That is correct dedup behaviour, not a failure.
      if (error.code === "23505") {
        skipped += chunk.length;
        continue;
      }
      throw new Error(`Ingest failed: ${error.message}`);
    }
    inserted += data?.length ?? 0;
  }

  return { seen: items.length, inserted, skipped };
}

/** Opens a sync_runs row. Pair with finishSyncRun. */
export async function startSyncRun(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  connectionId?: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("sync_runs")
    .insert({ user_id: userId, provider, connection_id: connectionId ?? null })
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function finishSyncRun(
  supabase: SupabaseClient,
  runId: string | null,
  result: { seen: number; inserted: number },
  error?: string,
): Promise<void> {
  if (!runId) return;
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      items_seen: result.seen,
      items_upserted: result.inserted,
      status: error ? "error" : "success",
      error: error ?? null,
    })
    .eq("id", runId);
}
