import type { CategorizationResult, CategoryLabel, GoalMatch, ResourceContentType, UserGoal } from "./types";

export type ProductCategory = { slug: string; label: string };

/**
 * Fixed product taxonomy. The AI-assisted pass (categorize-resource-ai.ts) is
 * constrained to these slugs plus at most one proposed new category; the
 * deterministic pass below only ever returns slugs from this list plus "other".
 */
export const PRODUCT_TAXONOMY: ProductCategory[] = [
  { slug: "fitness", label: "Fitness" },
  { slug: "programming", label: "Programming" },
  { slug: "ai", label: "AI & Machine Learning" },
  { slug: "education", label: "Education" },
  { slug: "career", label: "Career" },
  { slug: "food", label: "Food & Cooking" },
  { slug: "travel", label: "Travel" },
  { slug: "finance", label: "Finance" },
  { slug: "productivity", label: "Productivity" },
  { slug: "entertainment", label: "Entertainment" },
  { slug: "health", label: "Health & Wellness" },
  { slug: "other", label: "Other" },
];

const TAXONOMY_LABEL_BY_SLUG = new Map(PRODUCT_TAXONOMY.map((category) => [category.slug, category.label]));

/** Keyword -> category rules for the cheap, AI-free first pass described in section 10.2. */
const KEYWORD_RULES: Record<string, string[]> = {
  fitness: [
    "workout",
    "exercise",
    "gym",
    "mobility",
    "strength training",
    "cardio",
    "yoga",
    "running",
    "shoulder",
    "stretch",
    "fitness",
    "muscle",
  ],
  programming: [
    "oauth",
    "javascript",
    "typescript",
    "python",
    "coding",
    "programming",
    "software engineer",
    "api",
    "github",
    "react",
    "database",
    "algorithm",
    "developer",
  ],
  ai: [
    "machine learning",
    "artificial intelligence",
    "ai",
    "llm",
    "chatgpt",
    "neural network",
    "deep learning",
    "openai",
    "anthropic",
    "claude",
    "gpt",
  ],
  education: ["course", "tutorial", "lecture", "learn", "how to", "lesson", "study", "explained"],
  career: ["resume", "career", "job interview", "linkedin", "promotion", "salary negotiation"],
  food: ["recipe", "cooking", "baking", "ingredient", "dinner", "breakfast", "meal prep"],
  travel: ["itinerary", "travel", "flight", "passport", "vacation", "destination"],
  finance: ["invest", "budgeting", "stock market", "retirement", "personal finance", "401k"],
  productivity: ["productivity", "time management", "focus", "habit", "notion"],
  entertainment: ["movie", "trailer", "comedy", "meme", "gaming", "playlist"],
  health: ["nutrition", "mental health", "sleep", "meditation", "wellness", "therapy"],
};

const ACTIONABLE_KEYWORDS = ["how to", "guide", "step", "steps", "recipe", "tutorial", "checklist", "template"];
const URGENT_KEYWORDS = ["breaking", "deadline", "this week", "today only", "limited time", "expires"];

const GOAL_STOPWORDS = new Set([
  "improve",
  "learn",
  "my",
  "advance",
  "plan",
  "for",
  "a",
  "an",
  "the",
  "to",
  "more",
  "build",
  "grow",
]);

const DEFAULT_COGNITIVE_EFFORT: Record<ResourceContentType, number> = {
  short_video: 0.2,
  social_post: 0.2,
  video: 0.4,
  article: 0.5,
  newsletter: 0.35,
  other: 0.4,
};

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(haystack: string, keyword: string): boolean {
  return new RegExp(`\\b${escapeRegExp(keyword.trim())}\\b`, "i").test(haystack);
}

export type ConfirmationLevel = "preselect" | "confirm" | "manual";

/** Section 10.4 thresholds: how much the UI should trust an automated suggestion. */
export function getConfirmationLevel(confidence: number): ConfirmationLevel {
  if (confidence >= 0.75) return "preselect";
  if (confidence >= 0.45) return "confirm";
  return "manual";
}

export type DeterministicCategorizationInput = {
  title?: string;
  description?: string;
  extractedText?: string;
  userNote?: string;
  bookmarkFolderHint?: string;
  contentType: ResourceContentType;
  goals: UserGoal[];
};

function combinedText(input: DeterministicCategorizationInput): string {
  return [input.title, input.description, input.userNote, input.bookmarkFolderHint, input.extractedText?.slice(0, 1000)]
    .filter(Boolean)
    .join("\n");
}

function matchCategories(text: string): CategoryLabel[] {
  const scored: CategoryLabel[] = [];

  for (const [slug, keywords] of Object.entries(KEYWORD_RULES)) {
    const matchedCount = keywords.filter((keyword) => containsKeyword(text, keyword)).length;
    if (matchedCount === 0) continue;

    scored.push({
      slug,
      label: TAXONOMY_LABEL_BY_SLUG.get(slug) ?? slug,
      confidence: clamp01(0.5 + 0.15 * (matchedCount - 1)),
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, 3);
}

function matchGoals(text: string, categories: CategoryLabel[], goals: UserGoal[]): GoalMatch[] {
  const matchedSlugs = new Set(categories.map((category) => category.slug));

  return goals
    .map((goal): GoalMatch | null => {
      const words = goal.name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2 && !GOAL_STOPWORDS.has(word));

      let matchedWords = 0;
      const reasons: string[] = [];

      for (const word of words) {
        if (matchedSlugs.has(word) || containsKeyword(text, word)) {
          matchedWords += 1;
          reasons.push(word);
        }
      }

      if (matchedWords === 0) return null;

      return {
        goalId: goal.id,
        relevance: clamp01(0.55 + 0.15 * (matchedWords - 1)),
        reason: `Matches "${reasons.join(", ")}" from your goal "${goal.name}"`,
      };
    })
    .filter((match): match is GoalMatch => match !== null);
}

/**
 * Deterministic, AI-free categorization: source/content-type + keyword rules,
 * default effort by format, and goal candidates from keyword overlap. Runs
 * before any AI call so the product is demoable without one and so latency
 * stays low.
 */
export function categorizeDeterministically(input: DeterministicCategorizationInput): CategorizationResult {
  const text = combinedText(input);
  const matchedCategories = matchCategories(text);

  const categories: CategoryLabel[] =
    matchedCategories.length > 0
      ? matchedCategories
      : [{ slug: "other", label: "Other", confidence: 0.3 }];

  const goalMatches = matchGoals(text, categories, input.goals);

  const actionability = ACTIONABLE_KEYWORDS.some((keyword) => containsKeyword(text, keyword)) ? 0.7 : 0.4;
  const timeSensitivity = URGENT_KEYWORDS.some((keyword) => containsKeyword(text, keyword)) ? 0.6 : 0.2;

  const topCategoryConfidence = categories[0]?.confidence ?? 0;
  const goalBonus = Math.min(0.1, 0.05 * goalMatches.length);
  const confidence = matchedCategories.length === 0 ? 0.3 : clamp01(topCategoryConfidence + goalBonus);

  return {
    categories,
    goalMatches,
    cognitiveEffort: DEFAULT_COGNITIVE_EFFORT[input.contentType],
    actionability: clamp01(actionability),
    timeSensitivity: clamp01(timeSensitivity),
    confidence: clamp01(confidence),
  };
}
