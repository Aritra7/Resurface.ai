import { describe, expect, it } from "vitest";
import { canonicalizeUrl, isBlockedHost } from "./canonicalize-url";
import { ResourceIngestionError } from "./types";

describe("canonicalizeUrl: protocol rejection", () => {
  const cases: Array<{ url: string; code: string }> = [
    { url: "ftp://example.com/file", code: "UNSUPPORTED_PROTOCOL" },
    { url: "javascript:alert(1)", code: "UNSUPPORTED_PROTOCOL" },
    { url: "not a url", code: "INVALID_URL" },
    { url: "", code: "INVALID_URL" },
    { url: "http://127.0.0.1/admin", code: "BLOCKED_DESTINATION" },
    { url: "http://localhost:3000/", code: "BLOCKED_DESTINATION" },
    { url: "http://169.254.169.254/latest/meta-data", code: "BLOCKED_DESTINATION" },
    { url: "http://10.0.0.5/internal", code: "BLOCKED_DESTINATION" },
    { url: "http://192.168.1.1/", code: "BLOCKED_DESTINATION" },
    { url: "http://[::1]/", code: "BLOCKED_DESTINATION" },
  ];

  for (const { url, code } of cases) {
    it(`rejects ${JSON.stringify(url)} with ${code}`, () => {
      expect.assertions(2);
      try {
        canonicalizeUrl(url);
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceIngestionError);
        expect((error as ResourceIngestionError).code).toBe(code);
      }
    });
  }

  it("accepts a normal public https host", () => {
    expect(() => canonicalizeUrl("https://example.com/article")).not.toThrow();
  });
});

describe("isBlockedHost", () => {
  const blocked = [
    "127.0.0.1",
    "localhost",
    "sub.localhost",
    "169.254.169.254",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
  ];
  const allowed = ["example.com", "www.youtube.com", "8.8.8.8", "172.32.0.1", "203.0.113.5"];

  for (const host of blocked) {
    it(`blocks ${host}`, () => expect(isBlockedHost(host)).toBe(true));
  }
  for (const host of allowed) {
    it(`allows ${host}`, () => expect(isBlockedHost(host)).toBe(false));
  }
});

describe("canonicalizeUrl: tracking-parameter removal", () => {
  it("strips utm, fbclid, and gclid params and the fragment", () => {
    const result = canonicalizeUrl(
      "https://example.com/post?utm_source=newsletter&utm_medium=email&fbclid=abc&gclid=xyz#section",
    );
    expect(result.canonicalUrl).toBe("https://example.com/post");
  });

  it("preserves non-tracking query parameters", () => {
    const result = canonicalizeUrl("https://example.com/search?q=oauth&utm_source=x");
    expect(result.canonicalUrl).toBe("https://example.com/search?q=oauth");
  });
});

describe("canonicalizeUrl: YouTube forms", () => {
  const cases = [
    ["https://youtu.be/abc123?si=tracking", "video"],
    ["https://www.youtube.com/watch?v=abc123&feature=share", "video"],
    ["https://m.youtube.com/watch?v=abc123", "video"],
    ["https://www.youtube.com/embed/abc123", "video"],
    ["https://www.youtube.com/shorts/abc123", "short_video"],
  ] as const;

  for (const [url, contentType] of cases) {
    it(`normalizes ${url}`, () => {
      const result = canonicalizeUrl(url);
      expect(result.source).toBe("youtube");
      expect(result.contentType).toBe(contentType);
      expect(result.canonicalUrl).toBe("https://www.youtube.com/watch?v=abc123");
      expect(result.externalId).toBe("abc123");
    });
  }

  it("produces the same canonical URL for every equivalent form (duplicate detection)", () => {
    const urls = cases.map(([url]) => canonicalizeUrl(url).canonicalUrl);
    expect(new Set(urls).size).toBe(1);
  });
});

describe("canonicalizeUrl: Instagram Reel vs post detection", () => {
  it("detects a Reel as short_video and strips tracking params", () => {
    const result = canonicalizeUrl("https://www.instagram.com/reel/XYZ/?igsh=tracking");
    expect(result.source).toBe("instagram");
    expect(result.contentType).toBe("short_video");
    expect(result.externalId).toBe("XYZ");
    expect(result.canonicalUrl).toBe("https://www.instagram.com/reel/XYZ/");
  });

  it("detects a post as social_post", () => {
    const result = canonicalizeUrl("https://instagram.com/p/ABC123/");
    expect(result.source).toBe("instagram");
    expect(result.contentType).toBe("social_post");
    expect(result.externalId).toBe("ABC123");
  });
});

describe("canonicalizeUrl: ordinary web links", () => {
  it("defaults source to web and content type to article", () => {
    const result = canonicalizeUrl("https://Example.com/Article?utm_source=x");
    expect(result.source).toBe("web");
    expect(result.contentType).toBe("article");
    expect(result.canonicalUrl).toBe("https://example.com/Article");
  });

  it("applies a browser_bookmark source hint for non-platform URLs", () => {
    const result = canonicalizeUrl("https://example.com/article", "browser_bookmark");
    expect(result.source).toBe("browser_bookmark");
  });

  it("ignores a source hint when the URL matches a known platform", () => {
    const result = canonicalizeUrl("https://youtu.be/abc123", "browser_bookmark");
    expect(result.source).toBe("youtube");
  });

  it("removes the default port", () => {
    const result = canonicalizeUrl("https://example.com:443/post");
    expect(result.canonicalUrl).toBe("https://example.com/post");
  });
});
