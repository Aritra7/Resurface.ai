import type { RecommendationResource } from "./types";

export const DEMO_PRIMARY_GOAL_IDS = ["programming"];

export function createDemoResources(nowInput: string): RecommendationResource[] {
  const now = new Date(nowInput);

  return [
    {
      id: "demo-fitness-reel",
      url: "https://www.instagram.com/reels/",
      source: "instagram",
      contentType: "short_video",
      title: "A better shoulder warm-up",
      estimatedMinutes: 1,
      cognitiveEffort: 0.15,
      actionability: 0.95,
      timeSensitivity: 0.15,
      savedAt: daysAgo(now, 18),
      status: "active",
      goalMatches: [{ goalId: "fitness", relevance: 0.92 }],
    },
    {
      id: "demo-oauth-short",
      url: "https://www.youtube.com/shorts/",
      source: "youtube",
      contentType: "short_video",
      title: "OAuth in sixty seconds",
      estimatedMinutes: 1,
      cognitiveEffort: 0.3,
      actionability: 0.62,
      timeSensitivity: 0.1,
      savedAt: daysAgo(now, 7),
      status: "active",
      goalMatches: [{ goalId: "programming", relevance: 0.82 }],
    },
    {
      id: "demo-oauth-video",
      url: "https://www.youtube.com/results?search_query=oauth+explained+visually",
      source: "youtube",
      contentType: "video",
      title: "Understanding OAuth visually",
      estimatedMinutes: 8,
      cognitiveEffort: 0.72,
      actionability: 0.83,
      timeSensitivity: 0.15,
      savedAt: daysAgo(now, 35),
      status: "active",
      goalMatches: [{ goalId: "programming", relevance: 0.96 }],
    },
    {
      id: "demo-technical-article",
      url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Authentication",
      source: "web",
      contentType: "article",
      title: "Authentication architecture notes",
      estimatedMinutes: 15,
      cognitiveEffort: 0.9,
      actionability: 0.82,
      timeSensitivity: 0.2,
      savedAt: daysAgo(now, 52),
      status: "active",
      goalMatches: [{ goalId: "programming", relevance: 0.94 }],
    },
    {
      id: "demo-hackathon-deadline",
      url: "https://example.com/hackathon-submission",
      source: "web",
      contentType: "article",
      title: "Hackathon submission checklist",
      estimatedMinutes: 4,
      cognitiveEffort: 0.55,
      actionability: 0.96,
      timeSensitivity: 0.82,
      timeSensitivityReason: "The submission deadline is approaching",
      relevantUntil: daysFromNow(now, 2),
      savedAt: daysAgo(now, 3),
      status: "active",
      goalMatches: [{ goalId: "programming", relevance: 0.86 }],
    },
    {
      id: "demo-career-newsletter",
      url: "https://example.com/product-newsletter",
      source: "newsletter",
      contentType: "newsletter",
      title: "The product idea validation issue",
      estimatedMinutes: 5,
      cognitiveEffort: 0.45,
      actionability: 0.74,
      timeSensitivity: 0.35,
      savedAt: daysAgo(now, 94),
      status: "active",
      goalMatches: [{ goalId: "career", relevance: 0.76 }],
    },
  ];
}

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function daysFromNow(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}
