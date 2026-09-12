export type ResourceSource = "instagram" | "youtube" | "gmail" | "browser_bookmark" | "web";

export type ResourceContentType =
  | "short_video"
  | "video"
  | "social_post"
  | "article"
  | "newsletter"
  | "other";

export type IngestionInput = {
  url: string;
  userNote?: string;
  suppliedTitle?: string;
  sourceHint?: ResourceSource;
  categoryHints?: string[];
  importedAt?: string;
};

export type NormalizedCandidate = {
  originalUrl: string;
  canonicalUrl: string;
  source: ResourceSource;
  contentType: ResourceContentType;
  externalId?: string;
  title?: string;
  description?: string;
  extractedText?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  estimatedMinutes: number;
  durationIsEstimated: boolean;
  userNote?: string;
  savedAt: string;
  extractionWarnings: string[];
};

export type CategoryLabel = {
  slug: string;
  label: string;
  confidence: number;
};

export type GoalMatch = {
  goalId: string;
  relevance: number;
  reason: string;
};

export type CategorizationResult = {
  summary?: string;
  categories: CategoryLabel[];
  goalMatches: GoalMatch[];
  cognitiveEffort: number;
  actionability: number;
  timeSensitivity: number;
  confidence: number;
};

export type UserGoal = {
  id: string;
  name: string;
};

export type ResourceErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "BLOCKED_DESTINATION"
  | "METADATA_UNAVAILABLE"
  | "FETCH_TIMEOUT"
  | "FETCH_TOO_LARGE"
  | "DUPLICATE_RESOURCE"
  | "AI_OUTPUT_INVALID"
  | "UNAUTHENTICATED";

export class ResourceIngestionError extends Error {
  code: ResourceErrorCode;

  constructor(code: ResourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ResourceIngestionError";
  }
}

export type ResourcePreview = {
  candidate: NormalizedCandidate;
  suggestions: CategorizationResult;
  duplicate: { resourceId: string } | null;
  warnings: string[];
};
