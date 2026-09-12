import { clamp01, daysBetween } from "./math";
import type { RecommendationResource } from "./types";

const DEFAULT_TIME_SENSITIVITY = 0.2;

export type UrgencyResult = {
  value: number;
  deadlineDays: number | null;
  expired: boolean;
};

export function calculateUrgency(
  resource: RecommendationResource,
  nowInput: string,
): UrgencyResult {
  const now = new Date(nowInput);
  const base = clamp01(resource.timeSensitivity ?? DEFAULT_TIME_SENSITIVITY);
  let value = base;
  let deadlineDays: number | null = null;
  let expired = false;

  if (resource.relevantUntil) {
    const relevantUntil = new Date(resource.relevantUntil);
    if (Number.isFinite(relevantUntil.getTime())) {
      deadlineDays = daysBetween(relevantUntil, now);
      if (deadlineDays < 0) {
        expired = true;
        value = 0;
      } else if (deadlineDays <= 2) {
        value = Math.max(value, 1);
      } else if (deadlineDays <= 7) {
        value = Math.max(value, 0.75);
      } else if (deadlineDays <= 14) {
        value = Math.max(value, 0.5);
      }
    }
  }

  // Only inherently changing content gets a freshness boost. This prevents a newly
  // published evergreen tutorial from outranking an older, more useful resource.
  if (!expired && base >= 0.5 && resource.publishedAt) {
    const publishedAt = new Date(resource.publishedAt);
    if (Number.isFinite(publishedAt.getTime())) {
      const ageDays = daysBetween(now, publishedAt);
      if (ageDays >= 0 && ageDays <= 2) value = Math.max(value, 0.85);
      else if (ageDays <= 7) value = Math.max(value, 0.6);
      else if (ageDays <= 30) value = Math.max(value, 0.35);
    }
  }

  return { value: clamp01(value), deadlineDays, expired };
}
