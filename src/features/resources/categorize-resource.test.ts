import { describe, expect, it } from "vitest";
import { categorizeDeterministically, clamp01, getConfirmationLevel } from "./categorize-resource";
import type { UserGoal } from "./types";

const GOALS: UserGoal[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Improve fitness" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Learn programming" },
  { id: "33333333-3333-3333-3333-333333333333", name: "Plan a trip" },
];

describe("categorizeDeterministically", () => {
  it("categorizes an Instagram fitness Reel and matches the fitness goal", () => {
    const result = categorizeDeterministically({
      title: "Instagram Reel",
      userNote: "Shoulder mobility routine to try before workouts",
      contentType: "short_video",
      goals: GOALS,
    });

    expect(result.categories[0].slug).toBe("fitness");
    expect(result.goalMatches.map((m) => m.goalId)).toContain(GOALS[0].id);
    expect(result.cognitiveEffort).toBe(0.2);
  });

  it("categorizes a YouTube programming video and matches the programming goal", () => {
    const result = categorizeDeterministically({
      title: "OAuth explained visually",
      description: "A JavaScript tutorial walking through the OAuth authorization code flow.",
      contentType: "video",
      goals: GOALS,
    });

    expect(result.categories.map((c) => c.slug)).toContain("programming");
    expect(result.goalMatches.map((m) => m.goalId)).toContain(GOALS[1].id);
    expect(result.actionability).toBeGreaterThan(0.4); // "tutorial" is an actionable keyword
  });

  it("categorizes an AI-related article distinctly from programming", () => {
    const result = categorizeDeterministically({
      title: "How large language models actually work",
      description: "An explainer on neural network training for modern AI systems.",
      contentType: "article",
      goals: [],
    });

    expect(result.categories.map((c) => c.slug)).toContain("ai");
  });

  it("falls back to the 'other' category with low confidence when nothing matches", () => {
    const result = categorizeDeterministically({
      title: "Untitled",
      contentType: "other",
      goals: GOALS,
    });

    expect(result.categories).toEqual([{ slug: "other", label: "Other", confidence: 0.3 }]);
    expect(result.goalMatches).toHaveLength(0);
    expect(result.confidence).toBeLessThan(0.45);
    expect(getConfirmationLevel(result.confidence)).toBe("manual");
  });

  it("never returns a category or goal relevance outside 0..1", () => {
    const result = categorizeDeterministically({
      title: "workout workout workout fitness fitness fitness gym gym gym exercise exercise",
      contentType: "short_video",
      goals: GOALS,
    });

    for (const category of result.categories) {
      expect(category.confidence).toBeGreaterThanOrEqual(0);
      expect(category.confidence).toBeLessThanOrEqual(1);
    }
    for (const match of result.goalMatches) {
      expect(match.relevance).toBeGreaterThanOrEqual(0);
      expect(match.relevance).toBeLessThanOrEqual(1);
    }
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("uses the bookmark folder hint as a weak signal, not unquestioned truth", () => {
    const withHint = categorizeDeterministically({
      title: "Some Link",
      bookmarkFolderHint: "Cooking recipes",
      contentType: "article",
      goals: [],
    });

    expect(withHint.categories.map((c) => c.slug)).toContain("food");
  });
});

describe("clamp01", () => {
  const cases: Array<[number, number]> = [
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [1.5, 1],
    [Number.NaN, 0],
  ];

  for (const [input, expected] of cases) {
    it(`clamps ${input} to ${expected}`, () => expect(clamp01(input)).toBe(expected));
  }
});

describe("getConfirmationLevel", () => {
  it("preselects at or above 0.75", () => {
    expect(getConfirmationLevel(0.75)).toBe("preselect");
    expect(getConfirmationLevel(0.9)).toBe("preselect");
  });

  it("requires confirmation between 0.45 and 0.75", () => {
    expect(getConfirmationLevel(0.45)).toBe("confirm");
    expect(getConfirmationLevel(0.74)).toBe("confirm");
  });

  it("requires manual selection below 0.45", () => {
    expect(getConfirmationLevel(0.44)).toBe("manual");
    expect(getConfirmationLevel(0)).toBe("manual");
  });
});
