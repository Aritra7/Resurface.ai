import { describe, expect, it } from "vitest";
import { canonicalize } from "../canonical";

/**
 * Regression cover for the bookmark import that reported "0 of 80".
 *
 * Chrome bookmarks collide on canonical_url far more often than expected: the same
 * article filed in two folders, or saved twice with different tracking parameters.
 * Postgres aborts the whole statement on such a conflict, so a single duplicate used
 * to discard every other row in the chunk.
 */
describe("bookmark canonical collisions", () => {
  it("recognises bookmarks that differ only by tracking parameters as one URL", () => {
    const a = canonicalize("https://example.com/article?utm_source=newsletter");
    const b = canonicalize("https://example.com/article");
    expect(a?.canonicalUrl).toBe(b?.canonicalUrl);
  });

  it("recognises the same video bookmarked in long and short form as one URL", () => {
    const a = canonicalize("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const b = canonicalize("https://youtu.be/dQw4w9WgXcQ?si=share");
    expect(a?.canonicalUrl).toBe(b?.canonicalUrl);
  });

  it("keeps genuinely different bookmarks distinct", () => {
    const urls = [
      "https://example.com/a",
      "https://example.com/b",
      "https://other.com/a",
    ];
    const canonical = urls.map((u) => canonicalize(u)?.canonicalUrl);
    expect(new Set(canonical).size).toBe(3);
  });

  it("treats http and https versions of one page as the same bookmark", () => {
    expect(canonicalize("http://example.com/x")?.canonicalUrl).toBe(
      canonicalize("https://example.com/x")?.canonicalUrl,
    );
  });
});
