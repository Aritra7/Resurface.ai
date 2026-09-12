import { describe, expect, it } from "vitest";
import { enrichYoutube, parseIso8601Duration } from "./youtube";

describe("parseIso8601Duration", () => {
  const cases: Array<[string, number | null]> = [
    ["PT4M13S", 253],
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["PT20M", 1200],
    ["PT2H", 7200],
    ["not-a-duration", null],
  ];

  for (const [input, expected] of cases) {
    it(`parses ${input}`, () => expect(parseIso8601Duration(input)).toBe(expected));
  }
});

describe("enrichYoutube", () => {
  it("prefers the Data API when an API key is configured and quota succeeds", async () => {
    const result = await enrichYoutube("abc123", "https://www.youtube.com/watch?v=abc123", {
      apiKey: "fake-key",
      fetcher: async () => ({
        items: [
          {
            snippet: { title: "OAuth explained visually", thumbnails: { medium: { url: "https://img/thumb.jpg" } } },
            contentDetails: { duration: "PT6M" },
          },
        ],
      }),
    });

    expect(result.title).toBe("OAuth explained visually");
    expect(result.durationSeconds).toBe(360);
    expect(result.durationIsEstimated).toBe(false);
  });

  it("falls back to oEmbed when no API key is configured", async () => {
    let calledUrl = "";
    const result = await enrichYoutube("abc123", "https://www.youtube.com/watch?v=abc123", {
      fetcher: async (url) => {
        calledUrl = url;
        return { title: "A great video", thumbnail_url: "https://img/thumb.jpg" };
      },
    });

    expect(calledUrl).toContain("oembed");
    expect(result.title).toBe("A great video");
    expect(result.durationIsEstimated).toBe(true);
  });

  it("returns a link-only fallback when every provider fails", async () => {
    const result = await enrichYoutube("abc123", "https://www.youtube.com/watch?v=abc123", {
      fetcher: async () => null,
    });

    expect(result.title).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
