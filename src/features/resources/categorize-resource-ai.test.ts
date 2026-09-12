import { describe, expect, it } from "vitest";
import { categorizeWithAi } from "./categorize-resource-ai";
import type { UserGoal } from "./types";

const GOALS: UserGoal[] = [{ id: "11111111-1111-1111-1111-111111111111", name: "Learn programming" }];

const baseInput = {
  title: "OAuth explained visually",
  source: "youtube" as const,
  contentType: "video" as const,
  goals: GOALS,
};

describe("categorizeWithAi", () => {
  it("returns null when no API key is configured and no completer is injected", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await categorizeWithAi(baseInput);
    expect(result).toBeNull();
  });

  it("parses a valid structured response and filters goal IDs against the caller's own goals", async () => {
    const result = await categorizeWithAi(baseInput, {
      complete: async () =>
        JSON.stringify({
          summary: "A visual explainer of the OAuth flow.",
          categories: [{ slug: "programming", confidence: 0.9 }],
          goalRelevance: [
            { goalId: GOALS[0].id, relevance: 0.9, reason: "Directly about programming" },
            { goalId: "not-a-real-goal-id", relevance: 0.9, reason: "Should be dropped" },
          ],
          cognitiveEffort: 0.4,
          actionability: 0.6,
          timeSensitivity: 0.1,
          confidence: 0.85,
        }),
    });

    expect(result).not.toBeNull();
    expect(result?.categories[0].slug).toBe("programming");
    expect(result?.goalMatches).toHaveLength(1);
    expect(result?.goalMatches[0].goalId).toBe(GOALS[0].id);
  });

  it("returns null for invalid JSON output", async () => {
    const result = await categorizeWithAi(baseInput, {
      complete: async () => "this is not json {{{",
    });
    expect(result).toBeNull();
  });

  it("returns null when the JSON is well-formed but fails schema validation", async () => {
    const result = await categorizeWithAi(baseInput, {
      complete: async () =>
        JSON.stringify({
          categories: [{ slug: "programming", confidence: 5 }], // out of 0..1 range
          goalRelevance: [],
          cognitiveEffort: 0.4,
          actionability: 0.6,
          timeSensitivity: 0.1,
          confidence: 0.85,
        }),
    });
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the completer itself fails", async () => {
    const result = await categorizeWithAi(baseInput, {
      complete: async () => {
        throw new Error("network error");
      },
    });
    expect(result).toBeNull();
  });
});
