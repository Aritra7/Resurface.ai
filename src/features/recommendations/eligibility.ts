import type { RecommendationContext, RecommendationResource } from "./types";

export function isEligible(
  resource: RecommendationResource,
  context: RecommendationContext,
): boolean {
  if (resource.status !== "active" && resource.status !== "snoozed") return false;
  if (!Number.isFinite(resource.estimatedMinutes) || resource.estimatedMinutes <= 0) {
    return false;
  }
  if (resource.estimatedMinutes > context.timeBudgetMinutes) return false;

  if (resource.status === "snoozed" && !resource.snoozedUntil) return false;

  if (resource.snoozedUntil) {
    const snoozedUntil = new Date(resource.snoozedUntil);
    const now = new Date(context.now);
    if (Number.isFinite(snoozedUntil.getTime()) && snoozedUntil > now) return false;
  }

  return true;
}
