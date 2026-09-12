import { describe, expect, it } from "vitest";
import { enrichWeb, parseHtmlMetadata } from "./web";
import { ResourceIngestionError } from "../types";

const SAMPLE_HTML = `
<!doctype html>
<html>
<head>
  <title>Fallback Title</title>
  <link rel="canonical" href="https://example.com/canonical-article" />
  <meta name="description" content="Fallback description" />
  <meta property="og:title" content="OAuth explained visually" />
  <meta property="og:description" content="A visual guide to OAuth 2.0 flows." />
  <meta property="og:image" content="https://example.com/thumb.jpg" />
</head>
<body>
  <script>trackPageView();</script>
  <article><p>${"word ".repeat(500)}</p></article>
</body>
</html>
`;

describe("parseHtmlMetadata", () => {
  it("prefers Open Graph fields and extracts canonical link + readable text", () => {
    const meta = parseHtmlMetadata(SAMPLE_HTML);
    expect(meta.ogTitle).toBe("OAuth explained visually");
    expect(meta.ogDescription).toBe("A visual guide to OAuth 2.0 flows.");
    expect(meta.ogImage).toBe("https://example.com/thumb.jpg");
    expect(meta.canonical).toBe("https://example.com/canonical-article");
    expect(meta.title).toBe("Fallback Title");
    expect(meta.text).not.toContain("trackPageView");
    expect(meta.text.split(" ").length).toBeGreaterThanOrEqual(500);
  });

  it("falls back to standard title and meta description when OG tags are absent", () => {
    const meta = parseHtmlMetadata(
      `<html><head><title>Plain Title</title><meta name="description" content="Plain description"></head><body></body></html>`,
    );
    expect(meta.title).toBe("Plain Title");
    expect(meta.metaDescription).toBe("Plain description");
  });
});

describe("enrichWeb", () => {
  it("extracts metadata and computes reading time from word count", async () => {
    const result = await enrichWeb("https://example.com/article", {
      fetchPage: async () => ({ body: SAMPLE_HTML, contentType: "text/html; charset=utf-8" }),
    });

    expect(result.title).toBe("OAuth explained visually");
    expect(result.description).toBe("A visual guide to OAuth 2.0 flows.");
    expect(result.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(result.canonicalUrl).toBe("https://example.com/canonical-article");
    expect(result.estimatedMinutes).toBe(3); // 500 words / 220 wpm -> ceil(2.27) = 3
    expect(result.warnings).toHaveLength(0);
  });

  it("falls back to the hostname when no title can be found", async () => {
    const result = await enrichWeb("https://example.com/mystery", {
      fetchPage: async () => ({ body: "<html><body>no head tags here</body></html>", contentType: "text/html" }),
    });

    expect(result.title).toBe("example.com");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("falls back to a link-only save on a soft fetch failure (timeout, too large, unavailable)", async () => {
    const result = await enrichWeb("https://example.com/unreachable", {
      fetchPage: async () => {
        throw new ResourceIngestionError("FETCH_TIMEOUT", "timed out");
      },
    });

    expect(result.title).toBeUndefined();
    expect(result.estimatedMinutes).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("rethrows a blocked destination instead of silently falling back", async () => {
    await expect(
      enrichWeb("https://example.com/redirects-to-internal", {
        fetchPage: async () => {
          throw new ResourceIngestionError("BLOCKED_DESTINATION", "blocked");
        },
      }),
    ).rejects.toMatchObject({ code: "BLOCKED_DESTINATION" });
  });

  it("treats a non-HTML response as link-only", async () => {
    const result = await enrichWeb("https://example.com/file.pdf", {
      fetchPage: async () => ({ body: "%PDF-1.4", contentType: "application/pdf" }),
    });

    expect(result.title).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
