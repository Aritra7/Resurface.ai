import { describe, expect, it } from "vitest";
import { buildResourcePreview } from "./ingest-resource";
import type { UserGoal } from "./types";

const GOALS: UserGoal[] = [{ id: "11111111-1111-1111-1111-111111111111", name: "Learn programming" }];

describe("buildResourcePreview", () => {
  it("builds a YouTube preview end-to-end using an injected fetcher, with no AI call for a confident match", async () => {
    let aiCalled = false;

    const preview = await buildResourcePreview(
      { url: "https://youtu.be/abc123?si=tracking" },
      GOALS,
      null,
      {
        youtubeFetcher: async () => ({
          title: "React hooks tutorial for building a JavaScript API",
          thumbnail_url: "https://img/thumb.jpg",
        }),
        aiCompleter: async () => {
          aiCalled = true;
          return "{}";
        },
      },
    );

    expect(preview.candidate.canonicalUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(preview.candidate.source).toBe("youtube");
    expect(preview.candidate.title).toBe("React hooks tutorial for building a JavaScript API");
    expect(preview.suggestions.categories.map((c) => c.slug)).toContain("programming");
    expect(preview.duplicate).toBeNull();
    expect(aiCalled).toBe(false);
  });

  it("calls the AI-assisted pass only when the deterministic pass is not already confident", async () => {
    let aiCalled = false;

    const preview = await buildResourcePreview(
      { url: "https://example.com/mystery-article" },
      [],
      null,
      {
        webFetchPage: async () => ({
          body: "<html><head><title>Some ambiguous content</title></head><body>Nothing recognizable here.</body></html>",
          contentType: "text/html",
        }),
        aiCompleter: async () => {
          aiCalled = true;
          return JSON.stringify({
            categories: [{ slug: "productivity", confidence: 0.8 }],
            goalRelevance: [],
            cognitiveEffort: 0.5,
            actionability: 0.5,
            timeSensitivity: 0.2,
            confidence: 0.8,
          });
        },
      },
    );

    expect(aiCalled).toBe(true);
    expect(preview.suggestions.categories[0].slug).toBe("productivity");
  });

  it("surfaces an existing duplicate resource id without re-fetching anything about it", async () => {
    const preview = await buildResourcePreview(
      { url: "https://example.com/already-saved" },
      [],
      { resourceId: "res-1" },
      {
        webFetchPage: async () => ({ body: "<html><head><title>Saved</title></head><body></body></html>", contentType: "text/html" }),
      },
    );

    expect(preview.duplicate).toEqual({ resourceId: "res-1" });
  });

  it("rejects a blocked destination instead of returning a preview", async () => {
    await expect(buildResourcePreview({ url: "http://127.0.0.1/admin" }, [], null)).rejects.toMatchObject({
      code: "BLOCKED_DESTINATION",
    });
  });

  it("falls back gracefully for an Instagram Reel with no retrievable metadata", async () => {
    const preview = await buildResourcePreview(
      { url: "https://www.instagram.com/reel/XYZ/", userNote: "Shoulder mobility routine" },
      [],
      null,
    );

    expect(preview.candidate.title).toBe("Instagram Reel");
    expect(preview.candidate.estimatedMinutes).toBe(1);
    expect(preview.candidate.durationIsEstimated).toBe(true);
    expect(preview.warnings.length).toBeGreaterThan(0);
  });
});
