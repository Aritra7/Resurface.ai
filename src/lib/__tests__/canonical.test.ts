import { describe, expect, it } from "vitest";
import { canonicalize } from "../canonical";

describe("canonicalize - YouTube", () => {
  it("collapses every YouTube URL shape for one video to a single canonical form", () => {
    const shapes = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "http://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc123tracking",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    ];

    const canonical = shapes.map((url) => canonicalize(url)?.canonicalUrl);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("https://youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("extracts the video id as externalId", () => {
    expect(canonicalize("https://youtu.be/dQw4w9WgXcQ")?.externalId).toBe("dQw4w9WgXcQ");
    expect(canonicalize("https://youtube.com/shorts/dQw4w9WgXcQ")?.externalId).toBe("dQw4w9WgXcQ");
  });

  it("keeps distinct videos distinct", () => {
    const a = canonicalize("https://youtu.be/dQw4w9WgXcQ")?.canonicalUrl;
    const b = canonicalize("https://youtu.be/oHg5SJYRHA0")?.canonicalUrl;
    expect(a).not.toBe(b);
  });

  it("does not mistake a channel URL for a video", () => {
    const result = canonicalize("https://www.youtube.com/@somechannel");
    expect(result?.platform).toBe("youtube");
    expect(result?.externalId).toBeUndefined();
  });
});

describe("canonicalize - Instagram", () => {
  it("collapses reel, reels, p and tv paths for one shortcode", () => {
    const shapes = [
      "https://www.instagram.com/reel/ABC123xyz/",
      "https://instagram.com/reels/ABC123xyz/",
      "https://www.instagram.com/p/ABC123xyz/",
      "https://www.instagram.com/tv/ABC123xyz/",
      "https://www.instagram.com/reel/ABC123xyz/?igsh=trackingjunk",
    ];

    const canonical = shapes.map((url) => canonicalize(url)?.canonicalUrl);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("https://instagram.com/p/ABC123xyz");
  });

  it("extracts the shortcode", () => {
    expect(canonicalize("https://instagram.com/reel/ABC123xyz/")?.externalId).toBe("ABC123xyz");
  });
});

describe("canonicalize - Reddit", () => {
  it("normalizes a permalink and derives the t3_ id", () => {
    const result = canonicalize(
      "https://www.reddit.com/r/MachineLearning/comments/1abc23/understanding_attention/",
    );
    expect(result?.canonicalUrl).toBe("https://reddit.com/r/MachineLearning/comments/1abc23");
    expect(result?.externalId).toBe("t3_1abc23");
  });
});

describe("canonicalize - generic web", () => {
  it("strips tracking params but preserves meaningful ones", () => {
    const result = canonicalize(
      "https://example.com/article?id=42&utm_source=twitter&fbclid=xyz",
    );
    expect(result?.canonicalUrl).toContain("id=42");
    expect(result?.canonicalUrl).not.toContain("utm_source");
    expect(result?.canonicalUrl).not.toContain("fbclid");
  });

  it("treats param order as insignificant", () => {
    const a = canonicalize("https://example.com/x?b=2&a=1")?.canonicalUrl;
    const b = canonicalize("https://example.com/x?a=1&b=2")?.canonicalUrl;
    expect(a).toBe(b);
  });

  it("drops www and forces https", () => {
    expect(canonicalize("http://www.example.com/page")?.canonicalUrl).toBe(
      "https://example.com/page",
    );
  });

  it("rejects non-http protocols and junk", () => {
    expect(canonicalize("javascript:alert(1)")).toBeNull();
    expect(canonicalize("not a url")).toBeNull();
    expect(canonicalize("")).toBeNull();
  });
});
