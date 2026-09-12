import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategorizationResult, ResourceContentType, ResourceSource, UserGoal } from "./types";

export type UpsertResourceResult = {
  resourceId: string;
  isNew: boolean;
};

/** Fields needed to persist a resource row — a subset of NormalizedCandidate, satisfied by it structurally. */
export type ResourcePersistFields = {
  canonicalUrl: string;
  source: ResourceSource;
  contentType: ResourceContentType;
  title?: string;
  description?: string;
  userNote?: string;
  estimatedMinutes: number;
  externalId?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  durationIsEstimated: boolean;
};

/**
 * Idempotent insert/lookup keyed on (user_id, canonical_url). Never accepts a
 * user id from the caller — RLS + auth.uid() inside the SQL function derive it
 * from the authenticated session.
 */
export async function upsertResource(
  supabase: SupabaseClient,
  candidate: ResourcePersistFields,
  originalUrl: string,
): Promise<UpsertResourceResult> {
  const { data, error } = await supabase
    .rpc("upsert_resource", {
      p_url: originalUrl,
      p_canonical_url: candidate.canonicalUrl,
      p_source: candidate.source,
      p_content_type: candidate.contentType,
      p_title: candidate.title ?? null,
      p_description: candidate.description ?? null,
      p_user_note: candidate.userNote ?? null,
      p_estimated_minutes: candidate.estimatedMinutes,
      p_external_id: candidate.externalId ?? null,
      p_thumbnail_url: candidate.thumbnailUrl ?? null,
      p_duration_seconds: candidate.durationSeconds ?? null,
      p_duration_is_estimated: candidate.durationIsEstimated,
    })
    .single();

  if (error) {
    throw error;
  }

  const row = data as { resource_id: string; is_new: boolean };
  return { resourceId: row.resource_id, isNew: row.is_new };
}

export async function finalizeResourceCategorization(
  supabase: SupabaseClient,
  resourceId: string,
  result: CategorizationResult,
): Promise<void> {
  const { error } = await supabase.rpc("finalize_resource_categorization", {
    p_resource_id: resourceId,
    p_enrichment_status: "complete",
    p_summary: result.summary ?? null,
    p_categories: result.categories.map((category) => category.slug),
    p_cognitive_effort: result.cognitiveEffort,
    p_actionability: result.actionability,
    p_time_sensitivity: result.timeSensitivity,
    p_goal_matches: result.goalMatches.map((match) => ({ goalId: match.goalId, relevance: match.relevance })),
  });

  if (error) {
    throw error;
  }
}

export async function markResourceEnrichmentFailed(
  supabase: SupabaseClient,
  resourceId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabase.rpc("finalize_resource_categorization", {
    p_resource_id: resourceId,
    p_enrichment_status: "failed",
    p_goal_matches: [],
    p_enrichment_error_code: errorCode,
  });

  if (error) {
    throw error;
  }
}

export async function retryResourceEnrichment(supabase: SupabaseClient, resourceId: string): Promise<void> {
  const { error } = await supabase.rpc("retry_resource_enrichment", { p_resource_id: resourceId });
  if (error) {
    throw error;
  }
}

export async function findResourceByCanonicalUrl(
  supabase: SupabaseClient,
  canonicalUrl: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("resources")
    .select("id")
    .eq("canonical_url", canonicalUrl)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? { id: data.id as string } : null;
}

export type RetryableResource = {
  id: string;
  url: string;
  source: ResourceSource;
  userNote: string | null;
  enrichmentStatus: string;
};

export async function getResourceById(supabase: SupabaseClient, resourceId: string): Promise<RetryableResource | null> {
  const { data, error } = await supabase
    .from("resources")
    .select("id, url, source, user_note, enrichment_status")
    .eq("id", resourceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) return null;

  return {
    id: data.id as string,
    url: data.url as string,
    source: data.source as ResourceSource,
    userNote: data.user_note as string | null,
    enrichmentStatus: data.enrichment_status as string,
  };
}

export async function listActiveGoals(supabase: SupabaseClient): Promise<UserGoal[]> {
  const { data, error } = await supabase.from("goals").select("id, name").eq("active", true);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
}
