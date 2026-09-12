import { canonicalizeUrl } from "./canonicalize-url";
import { categorizeWithAi, type AiChatCompleter } from "./categorize-resource-ai";
import { categorizeDeterministically, getConfirmationLevel } from "./categorize-resource";
import { defaultEstimatedMinutes, estimateMinutesFromDurationSeconds } from "./estimate-duration";
import { enrichInstagram, type InstagramFetcher } from "./adapters/instagram";
import { enrichWeb, type WebPageFetcher } from "./adapters/web";
import { enrichYoutube, type YoutubeFetcher } from "./adapters/youtube";
import type { IngestionInput, NormalizedCandidate, ResourcePreview, UserGoal } from "./types";

export type IngestionDeps = {
  youtubeFetcher?: YoutubeFetcher;
  instagramFetcher?: InstagramFetcher;
  webFetchPage?: WebPageFetcher;
  aiCompleter?: AiChatCompleter;
};

/**
 * Runs adapter-specific enrichment. Every adapter already converts soft
 * failures (timeout, unreachable, unparsable) into a graceful link-only
 * fallback internally, so this only throws for genuinely invalid/unsafe
 * input (INVALID_URL, UNSUPPORTED_PROTOCOL, BLOCKED_DESTINATION) — the cases
 * that should refuse the save rather than store a degraded link.
 */
async function enrich(
  candidate: {
    canonicalUrl: string;
    source: NormalizedCandidate["source"];
    contentType: NormalizedCandidate["contentType"];
    externalId?: string;
  },
  deps: IngestionDeps,
): Promise<{
  title?: string;
  description?: string;
  extractedText?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  estimatedMinutes?: number;
  durationIsEstimated: boolean;
  warnings: string[];
}> {
  if (candidate.source === "youtube" && candidate.externalId) {
    const result = await enrichYoutube(candidate.externalId, candidate.canonicalUrl, { fetcher: deps.youtubeFetcher });
    return {
      title: result.title,
      thumbnailUrl: result.thumbnailUrl,
      durationSeconds: result.durationSeconds,
      estimatedMinutes: result.durationSeconds ? estimateMinutesFromDurationSeconds(result.durationSeconds) : undefined,
      durationIsEstimated: result.durationIsEstimated,
      warnings: result.warnings,
    };
  }

  if (candidate.source === "instagram") {
    const kind = candidate.contentType === "short_video" ? "reel" : "post";
    const result = await enrichInstagram(candidate.canonicalUrl, kind, { fetcher: deps.instagramFetcher });
    return {
      title: result.title,
      thumbnailUrl: result.thumbnailUrl,
      durationIsEstimated: result.durationIsEstimated,
      warnings: result.warnings,
    };
  }

  // web, browser_bookmark, and gmail (not yet implemented) all resolve to an
  // ordinary fetched web page for metadata purposes.
  const result = await enrichWeb(candidate.canonicalUrl, { fetchPage: deps.webFetchPage });
  return {
    title: result.title,
    description: result.description,
    extractedText: result.extractedText,
    thumbnailUrl: result.thumbnailUrl,
    estimatedMinutes: result.estimatedMinutes,
    durationIsEstimated: true,
    warnings: result.warnings,
  };
}

export async function buildNormalizedCandidate(
  input: IngestionInput,
  deps: IngestionDeps = {},
): Promise<NormalizedCandidate> {
  const canonical = canonicalizeUrl(input.url, input.sourceHint);
  const enrichment = await enrich(canonical, deps);

  const title = input.suppliedTitle?.trim() || enrichment.title;
  const estimatedMinutes = enrichment.estimatedMinutes ?? defaultEstimatedMinutes(canonical.contentType);

  return {
    originalUrl: input.url,
    canonicalUrl: canonical.canonicalUrl,
    source: canonical.source,
    contentType: canonical.contentType,
    externalId: canonical.externalId,
    title,
    description: enrichment.description,
    extractedText: enrichment.extractedText,
    thumbnailUrl: enrichment.thumbnailUrl,
    durationSeconds: enrichment.durationSeconds,
    estimatedMinutes,
    durationIsEstimated: enrichment.durationIsEstimated,
    userNote: input.userNote,
    savedAt: input.importedAt ?? new Date().toISOString(),
    extractionWarnings: enrichment.warnings,
  };
}

/**
 * Full preview pipeline for POST /api/resources/preview: canonicalize,
 * enrich, then categorize. Calls the optional AI pass only when the
 * deterministic pass didn't already reach the "preselect" confidence
 * threshold, to keep the common case fast and free of a model call.
 */
export async function buildResourcePreview(
  input: IngestionInput,
  goals: UserGoal[],
  duplicate: { resourceId: string } | null,
  deps: IngestionDeps = {},
): Promise<ResourcePreview> {
  const candidate = await buildNormalizedCandidate(input, deps);

  const deterministic = categorizeDeterministically({
    title: candidate.title,
    description: candidate.description,
    extractedText: candidate.extractedText,
    userNote: candidate.userNote,
    bookmarkFolderHint: input.categoryHints?.join(" "),
    contentType: candidate.contentType,
    goals,
  });

  let suggestions = deterministic;

  if (getConfirmationLevel(deterministic.confidence) !== "preselect") {
    const aiResult = await categorizeWithAi(
      {
        title: candidate.title,
        description: candidate.description,
        extractedText: candidate.extractedText,
        userNote: candidate.userNote,
        source: candidate.source,
        contentType: candidate.contentType,
        goals,
      },
      { complete: deps.aiCompleter },
    );
    if (aiResult) {
      suggestions = aiResult;
    }
  }

  return {
    candidate,
    suggestions,
    duplicate,
    warnings: candidate.extractionWarnings,
  };
}
