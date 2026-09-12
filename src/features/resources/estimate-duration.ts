import type { ResourceContentType } from "./types";

/** Fixed, documented reading-speed assumption. Keep in sync with docs/INGESTION_AND_CATEGORIZATION.md section 5.3. */
export const WORDS_PER_MINUTE = 220;

/** Used when no metadata or extracted text is available at all. */
const DEFAULT_MINUTES_BY_CONTENT_TYPE: Record<ResourceContentType, number> = {
  short_video: 1,
  social_post: 1,
  video: 5,
  article: 5,
  newsletter: 3,
  other: 5,
};

export function estimateReadingMinutes(wordCount: number): number {
  if (wordCount <= 0) return 1;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

export function estimateMinutesFromDurationSeconds(durationSeconds: number): number {
  if (durationSeconds <= 0) return 1;
  return Math.max(1, Math.round(durationSeconds / 60));
}

export function defaultEstimatedMinutes(contentType: ResourceContentType): number {
  return DEFAULT_MINUTES_BY_CONTENT_TYPE[contentType];
}
