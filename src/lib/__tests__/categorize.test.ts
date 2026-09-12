import { describe, expect, it } from "vitest";
import { categorize, matchGoals } from "../categorize";

const base = {
  url: "https://example.com/x",
  source: "web",
  contentType: "article",
  estimatedMinutes: 5,
};

describe("categorize - topics", () => {
  it("classifies a workout video as fitness", () => {
    const result = categorize({
      ...base,
      title: "Full Body Dumbbell Workout - 4 rounds",
      collection: "fitness",
      contentType: "video",
      estimatedMinutes: 15,
    });
    expect(result.categories[0]?.slug).toBe("fitness");
  });

  it("weights the user's own collection name above incidental title words", () => {
    // The title is neutral; only the folder says what this is.
    const result = categorize({ ...base, title: "Untitled", collection: "programming" });
    expect(result.categories[0]?.slug).toBe("programming");
  });

  it("uses the hostname when the title gives nothing away", () => {
    const result = categorize({ ...base, title: "Issue 4821", url: "https://github.com/x/y" });
    expect(result.categories.some((c) => c.slug === "programming")).toBe(true);
  });

  it("returns low confidence when nothing matches", () => {
    const result = categorize({ ...base, title: "asdfgh qwerty" });
    expect(result.categories).toHaveLength(0);
    expect(result.confidence).toBeLessThan(0.3);
  });

  it("keeps at most three categories", () => {
    const result = categorize({
      ...base,
      title: "Workout recipe code career travel investing study design funny",
    });
    expect(result.categories.length).toBeLessThanOrEqual(3);
  });
});

describe("categorize - optimizer signals", () => {
  it("rates a how-to as more actionable than a vlog", () => {
    const howTo = categorize({ ...base, title: "How to do a proper squat - step by step" });
    const vlog = categorize({ ...base, title: "My daily vlog - reaction to funny memes" });
    expect(howTo.actionability).toBeGreaterThan(vlog.actionability);
  });

  it("rates a long lecture as higher effort than a short reel", () => {
    const lecture = categorize({
      ...base, title: "Advanced compiler internals lecture",
      contentType: "video", estimatedMinutes: 45,
    });
    const reel = categorize({
      ...base, title: "Quick tip", contentType: "short_video", estimatedMinutes: 1,
    });
    expect(lecture.cognitiveEffort).toBeGreaterThan(reel.cognitiveEffort);
  });

  it("treats a deadline as time-sensitive and evergreen material as not", () => {
    const deadline = categorize({ ...base, title: "Application deadline - apply before Friday" });
    const evergreen = categorize({ ...base, title: "Fundamentals of typography" });
    expect(deadline.timeSensitivity).toBeGreaterThan(evergreen.timeSensitivity);
    expect(evergreen.timeSensitivity).toBeLessThan(0.3);
  });

  it("keeps every signal within 0..1 so the optimizer's weights stay meaningful", () => {
    const extreme = categorize({
      ...base,
      title: "How to deadline apply urgent sale limited advanced masterclass deep dive workout recipe",
      collection: "fitness",
      estimatedMinutes: 500,
    });
    for (const value of [extreme.actionability, extreme.cognitiveEffort, extreme.timeSensitivity]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("matchGoals", () => {
  const goals = [
    { id: "g-fit", name: "Improve fitness" },
    { id: "g-code", name: "Learn programming" },
    { id: "g-trip", name: "Plan a trip" },
  ];

  it("links a fitness resource to the fitness goal only", () => {
    const { categories } = categorize({
      ...base, title: "Dumbbell workout routine", collection: "fitness",
    });
    const matches = matchGoals(categories, goals);
    expect(matches.map((m) => m.goalId)).toContain("g-fit");
    expect(matches.map((m) => m.goalId)).not.toContain("g-trip");
  });

  it("produces no links when nothing is relevant", () => {
    const { categories } = categorize({ ...base, title: "zzzz qqqq" });
    expect(matchGoals(categories, goals)).toHaveLength(0);
  });

  it("returns relevance inside 0..1", () => {
    const { categories } = categorize({ ...base, title: "React and TypeScript tutorial" });
    for (const match of matchGoals(categories, goals)) {
      expect(match.relevance).toBeGreaterThan(0);
      expect(match.relevance).toBeLessThanOrEqual(1);
    }
  });
});
