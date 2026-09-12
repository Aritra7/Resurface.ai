import { aiCategorizationResponseSchema } from "./schemas";
import { PRODUCT_TAXONOMY } from "./categorize-resource";
import type { CategorizationResult, ResourceContentType, ResourceSource, UserGoal } from "./types";

export type AiCategorizationInput = {
  title?: string;
  description?: string;
  extractedText?: string;
  userNote?: string;
  source: ResourceSource;
  contentType: ResourceContentType;
  goals: UserGoal[];
};

/** Injectable so tests never depend on a live model call. */
export type AiChatCompleter = (systemPrompt: string, userPrompt: string) => Promise<string>;

const MAX_EXTRACTED_TEXT_FOR_PROMPT = 2000;

function buildPrompts(input: AiCategorizationInput): { system: string; user: string } {
  const taxonomySlugs = PRODUCT_TAXONOMY.map((category) => category.slug).join(", ");
  const goalList = input.goals.map((goal) => `${goal.id}: ${goal.name}`).join("\n") || "(no active goals)";

  const system = [
    "You classify a single saved link for a personal knowledge tool.",
    `Pick up to three categories from this fixed list when they fit: ${taxonomySlugs}.`,
    "You may propose at most one new category slug not in that list if none fit.",
    "You must return goal IDs exactly as given below; never invent a goal ID.",
    "Respond with strict JSON only, matching the required schema. No prose, no markdown fences.",
  ].join(" ");

  const user = [
    `Source: ${input.source}`,
    `Content type: ${input.contentType}`,
    `Title: ${input.title ?? "(none)"}`,
    `Description: ${input.description ?? "(none)"}`,
    `User note: ${input.userNote ?? "(none)"}`,
    input.extractedText ? `Extracted text: ${input.extractedText.slice(0, MAX_EXTRACTED_TEXT_FOR_PROMPT)}` : "",
    "",
    "Candidate goals (id: name):",
    goalList,
  ].join("\n");

  return { system, user };
}

async function callOpenAi(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI response contained no content");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs the AI-assisted pass when an OPENAI_API_KEY is configured, validating
 * the model's JSON with Zod before it can influence anything. Returns null
 * (never throws) when AI classification is disabled or the model's output is
 * unusable, so callers always have the deterministic pass to fall back to.
 */
export async function categorizeWithAi(
  input: AiCategorizationInput,
  deps: { complete?: AiChatCompleter } = {},
): Promise<CategorizationResult | null> {
  const complete = deps.complete ?? callOpenAi;

  if (!deps.complete && !process.env.OPENAI_API_KEY) {
    return null;
  }

  const { system, user } = buildPrompts(input);

  let raw: string;
  try {
    raw = await complete(system, user);
  } catch {
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = aiCategorizationResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return null;
  }

  const validGoalIds = new Set(input.goals.map((goal) => goal.id));
  const taxonomyLabels = new Map(PRODUCT_TAXONOMY.map((category) => [category.slug, category.label]));

  const categories = parsed.data.categories
    .slice(0, 3)
    .map((category) => ({
      slug: category.slug,
      label: taxonomyLabels.get(category.slug) ?? category.slug,
      confidence: category.confidence,
    }));

  const goalMatches = parsed.data.goalRelevance
    .filter((match) => validGoalIds.has(match.goalId))
    .map((match) => ({
      goalId: match.goalId,
      relevance: match.relevance,
      reason: match.reason ?? "Matched by AI-assisted classification",
    }));

  if (categories.length === 0) {
    return null;
  }

  return {
    summary: parsed.data.summary,
    categories,
    goalMatches,
    cognitiveEffort: parsed.data.cognitiveEffort,
    actionability: parsed.data.actionability,
    timeSensitivity: parsed.data.timeSensitivity,
    confidence: parsed.data.confidence,
  };
}
