import { describe, expect, it } from "vitest";
import { buildSession, calculateUrgency, isEligible, scoreResource } from ".";
import type { RecommendationContext, RecommendationResource } from ".";

const context: RecommendationContext = {
  timeBudgetMinutes: 10,
  energyMode: "balanced",
  primaryGoalIds: ["programming"],
  now: "2026-09-12T12:00:00.000Z",
};

function resource(
  overrides: Partial<RecommendationResource> = {},
): RecommendationResource {
  return {
    id: "base-resource",
    url: "https://example.com/resource",
    source: "web",
    contentType: "article",
    title: "A useful saved article",
    estimatedMinutes: 5,
    cognitiveEffort: 0.5,
    actionability: 0.5,
    timeSensitivity: 0.2,
    savedAt: "2026-08-12T12:00:00.000Z",
    status: "active",
    goalMatches: [{ goalId: "programming", relevance: 0.7 }],
    ...overrides,
  };
}

describe("eligibility", () => {
  it("excludes unfinished, oversized, and currently snoozed resources", () => {
    expect(isEligible(resource({ status: "unreviewed" }), context)).toBe(false);
    expect(isEligible(resource({ estimatedMinutes: 11 }), context)).toBe(false);
    expect(isEligible(resource({ snoozedUntil: "2026-09-13T12:00:00.000Z" }), context)).toBe(false);
    expect(isEligible(resource({ status: "snoozed", snoozedUntil: "2026-09-13T12:00:00.000Z" }), context)).toBe(false);
    expect(isEligible(resource({ status: "snoozed", snoozedUntil: "2026-09-11T12:00:00.000Z" }), context)).toBe(true);
    expect(isEligible(resource({ status: "snoozed", snoozedUntil: null }), context)).toBe(false);
  });
});

describe("dynamic urgency", () => {
  it("raises urgency as an explicit deadline approaches", () => {
    const item = resource({ timeSensitivity: 0.3 });
    expect(calculateUrgency({ ...item, relevantUntil: "2026-09-26T12:00:00.000Z" }, context.now).value).toBe(0.5);
    expect(calculateUrgency({ ...item, relevantUntil: "2026-09-18T12:00:00.000Z" }, context.now).value).toBe(0.75);
    expect(calculateUrgency({ ...item, relevantUntil: "2026-09-13T12:00:00.000Z" }, context.now).value).toBe(1);
  });

  it("removes urgency after the relevance deadline", () => {
    const result = calculateUrgency(
      resource({ timeSensitivity: 1, relevantUntil: "2026-09-11T12:00:00.000Z" }),
      context.now,
    );
    expect(result).toMatchObject({ value: 0, expired: true });
  });

  it("does not give evergreen content a freshness boost", () => {
    const result = calculateUrgency(
      resource({ timeSensitivity: 0.2, publishedAt: "2026-09-12T10:00:00.000Z" }),
      context.now,
    );
    expect(result.value).toBe(0.2);
  });
});

describe("resource scoring", () => {
  it("boosts a strong match to the user's primary goal", () => {
    const primary = scoreResource(resource({ id: "primary" }), context);
    const secondary = scoreResource(
      resource({ id: "secondary", goalMatches: [{ goalId: "fitness", relevance: 0.7 }] }),
      context,
    );
    expect(primary.components.goalRelevance).toBeGreaterThan(secondary.components.goalRelevance);
    expect(primary.score).toBeGreaterThan(secondary.score);
    expect(primary.explanations).toContain("Supports your main goal");
  });

  it("uses neutral defaults for missing enrichment signals", () => {
    const scored = scoreResource(
      resource({ actionability: null, cognitiveEffort: null, timeSensitivity: null }),
      context,
    );
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.score).toBeLessThanOrEqual(1);
  });
});

describe("session building", () => {
  const fixtures = [
    resource({ id: "fitness-reel", source: "instagram", contentType: "short_video", title: "Shoulder mobility", estimatedMinutes: 1, cognitiveEffort: 0.1, actionability: 0.9, goalMatches: [{ goalId: "fitness", relevance: 0.9 }] }),
    resource({ id: "oauth-short", source: "youtube", contentType: "short_video", title: "OAuth in sixty seconds", estimatedMinutes: 1, cognitiveEffort: 0.3, actionability: 0.6, goalMatches: [{ goalId: "programming", relevance: 0.8 }] }),
    resource({ id: "oauth-video", source: "youtube", contentType: "video", title: "OAuth explained", estimatedMinutes: 8, cognitiveEffort: 0.7, actionability: 0.8, goalMatches: [{ goalId: "programming", relevance: 0.95 }] }),
    resource({ id: "technical-article", source: "web", contentType: "article", title: "Authentication architecture", estimatedMinutes: 15, cognitiveEffort: 0.9, actionability: 0.8, goalMatches: [{ goalId: "programming", relevance: 0.95 }] }),
  ];

  it("never exceeds the user's time budget", () => {
    const queue = buildSession(fixtures, context);
    expect(queue.totalMinutes).toBeLessThanOrEqual(context.timeBudgetMinutes);
    expect(queue.unusedMinutes).toBe(context.timeBudgetMinutes - queue.totalMinutes);
  });

  it("produces a compact queue for a two-minute session", () => {
    const queue = buildSession(fixtures, { ...context, timeBudgetMinutes: 2, energyMode: "quick" });
    expect(queue.items.map((item) => item.resource.id)).toEqual(["fitness-reel", "oauth-short"]);
    expect(queue.totalMinutes).toBe(2);
  });

  it("can select deeper content when the user has more time", () => {
    const queue = buildSession(fixtures, { ...context, timeBudgetMinutes: 20, energyMode: "focused" });
    expect(queue.items.some((item) => item.resource.id === "technical-article")).toBe(true);
  });

  it("is deterministic even when scores tie", () => {
    const tied = [resource({ id: "b" }), resource({ id: "a" })];
    const first = buildSession(tied, context).items.map((item) => item.resource.id);
    const second = buildSession([...tied].reverse(), context).items.map((item) => item.resource.id);
    expect(first).toEqual(second);
  });

  it("rejects invalid session budgets", () => {
    expect(() => buildSession(fixtures, { ...context, timeBudgetMinutes: 0 })).toThrow(
      "timeBudgetMinutes must be a positive whole number",
    );
  });
});
