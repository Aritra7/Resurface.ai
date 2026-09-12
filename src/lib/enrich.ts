/**
 * Metadata enrichment for saved links.
 *
 * Per INGESTION_AND_CATEGORIZATION.md section 5, preferred order is a permitted API,
 * then public page metadata, then a link-only fallback. Failure must never lose the link.
 *
 * Sources used here:
 *   YouTube  -> oEmbed (no key, no quota)
 *   Instagram-> public OpenGraph tags on the permalink
 *   web      -> OpenGraph, then <title>
 *
 * The Instagram case is worth explaining. We request the permalink the same way any link
 * preview does, and read only the public OpenGraph tags Instagram itself publishes for
 * that purpose. No login, no session, no private Saved page, no media download — which
 * keeps us inside PRODUCT_FLOW.md section 11. Posts that are private or removed simply
 * return nothing and stay link-only.
 */
import { decodeHtmlEntities } from "./html";

/** Bounded so one slow host cannot stall a batch. */
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 512 * 1024;

export type Enrichment = {
  title?: string;
  description?: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
};

function metaTag(html: string, property: string): string | undefined {
  // Attribute order varies by site, so match both orderings rather than assuming one.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]).trim() || undefined;
  }
  return undefined;
}

async function fetchText(url: string, userAgent: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;

    // Cap the read: OG tags live in <head>, so there is no reason to buffer a whole page.
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    void reader.cancel();
    return new TextDecoder().decode(
      chunks.reduce((acc, c) => {
        const merged = new Uint8Array(acc.length + c.length);
        merged.set(acc);
        merged.set(c, acc.length);
        return merged;
      }, new Uint8Array()),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** YouTube oEmbed: no API key, no quota cost, and always public. */
async function enrichYouTube(url: string): Promise<Enrichment | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title,
      author: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Instagram publishes OpenGraph tags for link previews, shaped as:
 *   "Creator Name on Instagram: \"caption text\""
 * Splitting that yields a real author and a usable title.
 */
function parseInstagramOgTitle(raw: string): { author?: string; caption?: string } {
  const match = raw.match(/^([\s\S]*?)\s+on Instagram:\s*["""\u201c]([\s\S]*)["""\u201d]\s*$/);
  if (match) return { author: match[1].trim(), caption: match[2].trim() };

  const loose = raw.match(/^([\s\S]*?)\s+on Instagram/);
  if (loose) return { author: loose[1].trim() };

  return { caption: raw.trim() };
}

async function enrichInstagram(url: string): Promise<Enrichment | null> {
  // Instagram serves OG tags to link-preview crawlers but a login wall to a normal
  // browser UA, so identify honestly as a crawler to get the metadata it publishes.
  const html = await fetchText(
    url,
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  );
  if (!html) return null;

  const ogTitle = metaTag(html, "og:title");
  const ogDescription = metaTag(html, "og:description");
  const image = metaTag(html, "og:image");
  if (!ogTitle && !ogDescription && !image) return null;

  const { author, caption } = ogTitle ? parseInstagramOgTitle(ogTitle) : {};

  // A caption is the closest thing to a title a Reel has. Keep it short enough to read
  // in a queue, and fall back to the author when there is no caption at all.
  const title = caption
    ? caption.replace(/\s+/g, " ").slice(0, 150)
    : author
      ? `Instagram post by ${author}`
      : "Instagram post";

  return {
    title,
    description: ogDescription,
    author,
    thumbnailUrl: image,
  };
}

async function enrichWeb(url: string): Promise<Enrichment | null> {
  const html = await fetchText(
    url,
    "Mozilla/5.0 (compatible; ResurfaceBot/0.1; +https://resurface.ai)",
  );
  if (!html) return null;

  const titleTag = decodeHtmlEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const title = metaTag(html, "og:title") ?? (titleTag || undefined);

  return {
    title: title?.slice(0, 300),
    description: (metaTag(html, "og:description") ?? metaTag(html, "description"))?.slice(0, 1000),
    thumbnailUrl: metaTag(html, "og:image"),
  };
}

/** Routes to the right strategy. Returns null when nothing usable was found. */
export async function enrichUrl(url: string, source: string): Promise<Enrichment | null> {
  try {
    if (source === "youtube") return await enrichYouTube(url);
    if (source === "instagram") return await enrichInstagram(url);
    return await enrichWeb(url);
  } catch {
    return null;
  }
}
