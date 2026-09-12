/**
 * Deterministic categorization.
 *
 * INGESTION_AND_CATEGORIZATION.md section 10.2 asks for a cheap deterministic pass before
 * any AI call, so the product is demoable without an API key and stays independently
 * testable. Everything here is derived from signals we already hold: the URL, the
 * content type, the duration, and the collection the user filed it under.
 *
 * These values feed the optimizer directly:
 *   actionability    -> 0.20 of the score
 *   cognitiveEffort  -> contextFit, matched against the session's energy mode
 *   timeSensitivity  -> urgency
 *   goal relevance   -> 0.35, the single largest weight
 */

/** Topic taxonomy. Kept small on purpose; a sprawling one classifies nothing well. */
export const CATEGORIES = [
  "fitness",
  "programming",
  "career",
  "cooking",
  "travel",
  "finance",
  "study",
  "design",
  "entertainment",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Keyword signals per category. Matched against title, collection and hostname.
 * Ordered roughly by specificity: "workout" is a stronger fitness signal than "health".
 */
const KEYWORDS: Record<Category, string[]> = {
  fitness: ["workout", "exercise", "gym", "fitness", "muscle", "lift", "squat", "bench",
    "cardio", "running", "yoga", "stretch", "mobility", "protein", "hypertrophy",
    "reps", "sets", "abs", "bodyweight", "dumbbell", "physique", "bulking", "cutting"],
  programming: ["code", "coding", "programming", "developer", "javascript", "typescript",
    "python", "react", "nextjs", "api", "database", "sql", "docker", "kubernetes",
    "github", "algorithm", "backend", "frontend", "devops", "oauth", "compiler",
    "leetcode", "stackoverflow", "postgres", "rust", "golang"],
  career: ["career", "resume", "cv", "interview", "job", "hiring", "linkedin", "salary",
    "promotion", "internship", "recruiter", "networking", "portfolio", "application"],
  cooking: ["recipe", "cook", "cooking", "baking", "meal", "kitchen", "food", "dinner",
    "breakfast", "lunch", "chef", "ingredient", "pasta", "curry"],
  travel: ["travel", "trip", "flight", "hotel", "itinerary", "vacation", "backpack",
    "airbnb", "destination", "tourism", "visa"],
  finance: ["invest", "investing", "stock", "finance", "money", "budget", "savings",
    "tax", "crypto", "loan", "mortgage", "retirement", "debt"],
  study: ["study", "learn", "course", "lecture", "tutorial", "university", "college",
    "exam", "homework", "cmu", "mit", "stanford", "coursera", "textbook", "semester",
    "syllabus", "admission"],
  design: ["design", "figma", "ux", "ui", "typography", "color", "illustration",
    "branding", "layout", "prototype"],
  entertainment: ["funny", "comedy", "meme", "prank", "vlog", "reaction", "gaming",
    "gameplay", "movie", "trailer", "music", "song", "podcast"],
};

/** Hostnames that imply a category regardless of title wording. */
const HOST_HINTS: Array<[RegExp, Category]> = [
  [/github\.com|stackoverflow\.com|npmjs\.com|developer\.mozilla\.org|dev\.to/, "programming"],
  [/leetcode\.com|hackerrank\.com/, "programming"],
  [/linkedin\.com|indeed\.com|glassdoor\.com/, "career"],
  [/coursera\.org|edx\.org|khanacademy\.org|\.edu(\/|$)/, "study"],
  [/figma\.com|dribbble\.com|behance\.net/, "design"],
  [/allrecipes\.com|seriouseats\.com|bonappetit\.com/, "cooking"],
];

export type CategoryScore = { slug: Category; confidence: number };

export type CategorizationInput = {
  title?: string | null;
  description?: string | null;
  collection?: string | null;
  url: string;
  source: string;
  contentType: string;
  estimatedMinutes: number;
};

export type CategorizationResult = {
  categories: CategoryScore[];
  actionability: number;
  cognitiveEffort: number;
  timeSensitivity: number;
  confidence: number;
};

/**
 * Whole-word containment. Word boundaries are computed against non-alphanumerics so
 * "react" matches "React and TypeScript" and "react.dev" but not "reaction".
 */
function containsWord(haystackText: string, keyword: string): boolean {
  if (!haystackText) return false;
  let from = 0;
  for (;;) {
    const index = haystackText.indexOf(keyword, from);
    if (index === -1) return false;
    const before = index === 0 ? "" : haystackText[index - 1];
    const after = haystackText[index + keyword.length] ?? "";
    const boundedBefore = before === "" || !/[a-z0-9]/.test(before);
    const boundedAfter = after === "" || !/[a-z0-9]/.test(after);
    if (boundedBefore && boundedAfter) return true;
    from = index + 1;
  }
}

function haystack(input: CategorizationInput): string {
  let host = "";
  try {
    host = new URL(input.url).hostname;
  } catch {
    // A malformed URL simply contributes no host signal.
  }
  return [input.title, input.description, input.collection, host]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Scores every category by keyword hits, then keeps the top three.
 *
 * The collection name is weighted heavily and deliberately: a playlist or bookmark folder
 * is a label the user wrote themselves, which is far better evidence than an incidental
 * word in a title.
 */
export function categorize(input: CategorizationInput): CategorizationResult {
  const text = haystack(input);
  const collection = (input.collection ?? "").toLowerCase();
  const scores = new Map<Category, number>();

  for (const category of CATEGORIES) {
    let hits = 0;
    for (const keyword of KEYWORDS[category]) {
      // Whole-word matching. Plain substring search produces absurd hits: "exam" fires
      // inside "example.com", "api" inside "rapid", "ux" inside "luxury".
      if (!containsWord(text, keyword)) continue;
      // A hit inside the user's own collection name counts for much more.
      hits += containsWord(collection, keyword) ? 3 : 1;
    }
    // An exact collection-name match is the strongest signal available.
    if (collection === category) hits += 6;
    if (hits > 0) scores.set(category, hits);
  }

  for (const [pattern, category] of HOST_HINTS) {
    if (pattern.test(text)) scores.set(category, (scores.get(category) ?? 0) + 4);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const top = ranked[0]?.[1] ?? 0;

  const categories: CategoryScore[] = ranked.map(([slug, hits]) => ({
    slug,
    // Saturating rather than linear: 5 hits is confident, 50 is not ten times more so.
    confidence: Math.min(0.95, 0.35 + 0.12 * hits),
  }));

  return {
    categories,
    actionability: estimateActionability(input, categories),
    cognitiveEffort: estimateCognitiveEffort(input),
    timeSensitivity: estimateTimeSensitivity(input),
    // No keyword hit at all means we genuinely do not know what this is.
    confidence: top === 0 ? 0.2 : Math.min(0.9, 0.4 + 0.1 * top),
  };
}

/**
 * How likely the item leads to an action rather than passive consumption.
 * A workout you can perform or a tutorial you can follow beats a vlog.
 */
function estimateActionability(
  input: CategorizationInput,
  categories: CategoryScore[],
): number {
  const text = `${input.title ?? ""} ${input.collection ?? ""}`.toLowerCase();
  let score = 0.5;

  if (/how to|tutorial|guide|step|recipe|routine|workout|exercise|checklist|template/.test(text)) {
    score += 0.25;
  }
  if (/\b\d+\s*(ways|tips|steps|exercises|rules|habits)\b/.test(text)) score += 0.1;
  if (/vlog|reaction|funny|meme|prank|trailer|gameplay/.test(text)) score -= 0.25;
  if (categories[0]?.slug === "entertainment") score -= 0.15;
  if (categories[0]?.slug === "fitness" || categories[0]?.slug === "cooking") score += 0.1;

  return clamp(score);
}

/**
 * How much mental energy the item demands, matched against the session's energy mode.
 * Length is the dominant signal: a 45-minute lecture is focused work, a Reel is not.
 */
function estimateCognitiveEffort(input: CategorizationInput): number {
  let score: number;
  if (input.contentType === "short_video" || input.contentType === "social_post") score = 0.2;
  else if (input.contentType === "video") score = 0.45;
  else score = 0.5;

  if (input.estimatedMinutes >= 30) score += 0.3;
  else if (input.estimatedMinutes >= 15) score += 0.2;
  else if (input.estimatedMinutes >= 8) score += 0.1;
  else if (input.estimatedMinutes <= 2) score -= 0.1;

  const text = `${input.title ?? ""} ${input.collection ?? ""}`.toLowerCase();
  if (/deep dive|advanced|masterclass|lecture|paper|research|architecture|internals/.test(text)) {
    score += 0.15;
  }
  if (/quick|beginner|intro|basics|explained simply|in \d+ minutes/.test(text)) score -= 0.15;

  return clamp(score);
}

/**
 * How quickly usefulness decays. Most saved content is evergreen, so the default is low;
 * only explicit time markers raise it. Over-marking urgency would let it dominate scoring.
 */
function estimateTimeSensitivity(input: CategorizationInput): number {
  const text = `${input.title ?? ""} ${input.collection ?? ""}`.toLowerCase();
  let score = 0.15;

  if (/deadline|apply|application|due|expires|last chance|closing|register by/.test(text)) {
    score += 0.5;
  }
  if (/\b(20\d\d)\b/.test(text)) score += 0.1;
  if (/news|breaking|update|release|launch|announcement/.test(text)) score += 0.2;
  if (/sale|discount|offer|limited/.test(text)) score += 0.25;
  if (/timeless|fundamentals|principles|classic/.test(text)) score -= 0.1;

  return clamp(score);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(3))));
}

/**
 * Maps predicted categories onto the user's actual goals by name overlap.
 * Goal names are user-written ("Improve fitness"), so match on the category slug
 * appearing in the goal name, plus a small keyword fallback.
 */
export function matchGoals(
  categories: CategoryScore[],
  goals: Array<{ id: string; name: string }>,
): Array<{ goalId: string; relevance: number }> {
  const matches: Array<{ goalId: string; relevance: number }> = [];

  for (const goal of goals) {
    const goalText = goal.name.toLowerCase();
    let best = 0;

    for (const category of categories) {
      if (goalText.includes(category.slug)) {
        best = Math.max(best, category.confidence);
        continue;
      }
      // "Learn programming" should still match the study category, and so on.
      const overlap = KEYWORDS[category.slug].some((keyword) => containsWord(goalText, keyword));
      if (overlap) best = Math.max(best, category.confidence * 0.8);
    }

    if (best > 0) matches.push({ goalId: goal.id, relevance: Number(best.toFixed(3)) });
  }

  return matches;
}
