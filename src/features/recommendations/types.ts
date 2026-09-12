export type ResourceStatus =
  | "unreviewed"
  | "active"
  | "snoozed"
  | "completed"
  | "archived"
  | "unavailable";

export type EnergyMode = "quick" | "balanced" | "focused" | "surprise";

export type GoalMatch = {
  goalId: string;
  relevance: number;
};

export type RecommendationResource = {
  id: string;
  source: string;
  contentType: string;
  title: string;
  estimatedMinutes: number;
  cognitiveEffort?: number | null;
  actionability?: number | null;
  timeSensitivity?: number | null;
  timeSensitivityReason?: string | null;
  savedAt: string;
  publishedAt?: string | null;
  relevantUntil?: string | null;
  status: ResourceStatus;
  snoozedUntil?: string | null;
  goalMatches: GoalMatch[];
};

export type RecommendationContext = {
  timeBudgetMinutes: number;
  energyMode: EnergyMode;
  primaryGoalIds: string[];
  now: string;
};

export type ScoreComponents = {
  goalRelevance: number;
  actionability: number;
  urgency: number;
  ageBoost: number;
  contextFit: number;
};

export type ScoredResource = {
  resource: RecommendationResource;
  score: number;
  components: ScoreComponents;
  explanations: string[];
};

export type RecommendationQueue = {
  items: ScoredResource[];
  totalMinutes: number;
  unusedMinutes: number;
};
