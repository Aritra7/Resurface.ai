import { isEligible } from "./eligibility";
import { scoreResource } from "./score-resource";
import type {
  RecommendationContext,
  RecommendationQueue,
  RecommendationResource,
  ScoredResource,
} from "./types";

const SOURCE_REPEAT_PENALTY = 0.04;
const CONTENT_TYPE_REPEAT_PENALTY = 0.08;
const GOAL_REPEAT_PENALTY = 0.05;
const MAX_SAME_CONTENT_TYPE = 2;

export function buildSession(
  resources: RecommendationResource[],
  context: RecommendationContext,
): RecommendationQueue {
  if (!Number.isInteger(context.timeBudgetMinutes) || context.timeBudgetMinutes <= 0) {
    throw new Error("timeBudgetMinutes must be a positive whole number");
  }

  const remaining = resources
    .filter((resource) => isEligible(resource, context))
    .map((resource) => scoreResource(resource, context));
  const selected: ScoredResource[] = [];
  let remainingMinutes = context.timeBudgetMinutes;

  while (remaining.length > 0) {
    const fitting = remaining.filter(
      (candidate) => candidate.resource.estimatedMinutes <= remainingMinutes,
    );
    if (fitting.length === 0) break;

    const notAtFormatCap = fitting.filter(
      (candidate) => countContentType(selected, candidate.resource.contentType) < MAX_SAME_CONTENT_TYPE,
    );
    const candidatePool = notAtFormatCap.length > 0 ? notAtFormatCap : fitting;
    const next = [...candidatePool].sort((left, right) =>
      compareCandidates(left, right, selected),
    )[0];

    selected.push(next);
    remainingMinutes -= next.resource.estimatedMinutes;
    remaining.splice(remaining.findIndex((candidate) => candidate.resource.id === next.resource.id), 1);
  }

  return {
    items: selected,
    totalMinutes: context.timeBudgetMinutes - remainingMinutes,
    unusedMinutes: remainingMinutes,
  };
}

function compareCandidates(
  left: ScoredResource,
  right: ScoredResource,
  selected: ScoredResource[],
): number {
  const utilityDifference = marginalUtility(right, selected) - marginalUtility(left, selected);
  if (Math.abs(utilityDifference) > Number.EPSILON) return utilityDifference;

  const ageDifference = Date.parse(left.resource.savedAt) - Date.parse(right.resource.savedAt);
  if (Number.isFinite(ageDifference) && ageDifference !== 0) return ageDifference;
  return left.resource.id.localeCompare(right.resource.id);
}

function marginalUtility(candidate: ScoredResource, selected: ScoredResource[]): number {
  const sourceRepeats = selected.filter(
    (item) => item.resource.source === candidate.resource.source,
  ).length;
  const typeRepeats = countContentType(selected, candidate.resource.contentType);
  const candidateGoals = new Set(candidate.resource.goalMatches.map((match) => match.goalId));
  const goalRepeats = selected.filter((item) =>
    item.resource.goalMatches.some((match) => candidateGoals.has(match.goalId)),
  ).length;

  return candidate.score
    - SOURCE_REPEAT_PENALTY * sourceRepeats
    - CONTENT_TYPE_REPEAT_PENALTY * typeRepeats
    - GOAL_REPEAT_PENALTY * goalRepeats;
}

function countContentType(selected: ScoredResource[], contentType: string): number {
  return selected.filter((item) => item.resource.contentType === contentType).length;
}
