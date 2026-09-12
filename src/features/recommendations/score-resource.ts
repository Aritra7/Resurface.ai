import { clamp01, daysBetween, roundScore } from "./math";
import { calculateUrgency } from "./urgency";
import type {
  RecommendationContext,
  RecommendationResource,
  ScoredResource,
} from "./types";

const WEIGHTS = {
  goalRelevance: 0.35,
  actionability: 0.2,
  urgency: 0.15,
  ageBoost: 0.15,
  contextFit: 0.15,
} as const;

const ENERGY_TARGET = {
  quick: 0.2,
  balanced: 0.5,
  focused: 0.85,
  surprise: 0.5,
} as const;

export function scoreResource(
  resource: RecommendationResource,
  context: RecommendationContext,
): ScoredResource {
  const now = new Date(context.now);
  const savedAt = new Date(resource.savedAt);
  const savedDaysAgo = Number.isFinite(savedAt.getTime())
    ? Math.max(0, daysBetween(now, savedAt))
    : 0;

  const goalRelevance = calculateGoalRelevance(resource, context.primaryGoalIds);
  const actionability = clamp01(resource.actionability ?? 0.5);
  const urgencyResult = calculateUrgency(resource, context.now);
  const ageBoost = clamp01(savedDaysAgo / 90);
  const contextFit = calculateContextFit(resource, context);

  const components = {
    goalRelevance,
    actionability,
    urgency: urgencyResult.value,
    ageBoost,
    contextFit,
  };

  const score = roundScore(
    WEIGHTS.goalRelevance * goalRelevance
      + WEIGHTS.actionability * actionability
      + WEIGHTS.urgency * urgencyResult.value
      + WEIGHTS.ageBoost * ageBoost
      + WEIGHTS.contextFit * contextFit,
  );

  return {
    resource,
    score,
    components,
    explanations: buildExplanations(
      resource,
      context,
      components,
      savedDaysAgo,
      urgencyResult.deadlineDays,
    ),
  };
}

function calculateGoalRelevance(
  resource: RecommendationResource,
  primaryGoalIds: string[],
): number {
  return resource.goalMatches.reduce((best, match) => {
    const primaryBoost = primaryGoalIds.includes(match.goalId) ? 1.15 : 1;
    return Math.max(best, clamp01(match.relevance * primaryBoost));
  }, 0);
}

function calculateContextFit(
  resource: RecommendationResource,
  context: RecommendationContext,
): number {
  const effort = clamp01(resource.cognitiveEffort ?? 0.5);
  const effortFit = 1 - Math.abs(effort - ENERGY_TARGET[context.energyMode]);
  const durationFit = resource.estimatedMinutes <= context.timeBudgetMinutes ? 1 : 0;
  return clamp01(0.7 * effortFit + 0.3 * durationFit);
}

function buildExplanations(
  resource: RecommendationResource,
  context: RecommendationContext,
  components: ScoredResource["components"],
  savedDaysAgo: number,
  deadlineDays: number | null,
): string[] {
  const explanations: string[] = [];
  const supportsPrimaryGoal = resource.goalMatches.some(
    (match) => context.primaryGoalIds.includes(match.goalId) && match.relevance >= 0.6,
  );

  if (supportsPrimaryGoal) explanations.push("Supports your main goal");
  else if (components.goalRelevance >= 0.6) explanations.push("Strong match for one of your goals");

  if (deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 2) {
    explanations.push("Becomes less useful within two days");
  } else if (deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 7) {
    explanations.push("Relevant for less than a week");
  } else if (components.urgency >= 0.75) {
    explanations.push(resource.timeSensitivityReason ?? "Currently time-sensitive");
  }

  if (savedDaysAgo >= 30) explanations.push(`Waiting for ${Math.floor(savedDaysAgo)} days`);

  if (components.contextFit >= 0.75) {
    explanations.push(`Fits your ${context.energyMode} session`);
  }

  explanations.push(`Takes about ${resource.estimatedMinutes} minute${resource.estimatedMinutes === 1 ? "" : "s"}`);
  return explanations.slice(0, 3);
}
