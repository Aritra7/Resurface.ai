import { describe, expect, it } from "vitest";
import { enrichInstagram } from "./instagram";

describe("enrichInstagram", () => {
  it("falls back to a labeled placeholder title for a Reel when no metadata is available", async () => {
    const result = await enrichInstagram("https://www.instagram.com/reel/XYZ/", "reel");
    expect(result.title).toBe("Instagram Reel");
    expect(result.durationIsEstimated).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("falls back to a labeled placeholder title for a post", async () => {
    const result = await enrichInstagram("https://www.instagram.com/p/ABC/", "post");
    expect(result.title).toBe("Instagram post");
  });

  it("uses oEmbed data when an access token and fetcher return metadata", async () => {
    const result = await enrichInstagram("https://www.instagram.com/reel/XYZ/", "reel", {
      accessToken: "fake-token",
      fetcher: async () => ({ title: "Shoulder mobility routine", thumbnail_url: "https://img/thumb.jpg" }),
    });

    expect(result.title).toBe("Shoulder mobility routine");
    expect(result.thumbnailUrl).toBe("https://img/thumb.jpg");
  });

  it("never calls the network when no access token is configured", async () => {
    let called = false;
    await enrichInstagram("https://www.instagram.com/reel/XYZ/", "reel", {
      fetcher: async () => {
        called = true;
        return null;
      },
    });
    expect(called).toBe(false);
  });
});
