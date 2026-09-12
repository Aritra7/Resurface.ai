/**
 * Instagram saved-posts parser.
 *
 * Instagram exposes no API for a consumer's Saved collection at any approval tier, so
 * the supported route is the user's own data export. This parses the JSON that
 * Instagram's "Download your information" produces.
 *
 * The same schema is what Meta's Export Your Information destination program pushes to
 * approved partners, so this parser is the production parser; only the transport differs.
 *
 * We never ask for an Instagram password and never scrape the Saved page, per
 * PRODUCT_FLOW.md section 11 and INGESTION_AND_CATEGORIZATION.md section 5.1.
 *
 * Deliberately not marked "server-only": this is pure parsing with no secrets, no
 * network and no database access, so it stays unit-testable and could run client-side
 * if we ever parse the export in the browser.
 */
import { z } from "zod";

/**
 * Export shape:
 *   { "saved_saved_media": [
 *       { "title": "creator_username",
 *         "string_map_data": { "Saved on": { "href": "...", "timestamp": 1699999999 } } } ] }
 *
 * Instagram has shipped several key spellings over the years, so accept any key inside
 * string_map_data rather than hard-coding "Saved on" — a renamed key would otherwise
 * silently yield zero items.
 */
const StringMapValue = z.object({
  href: z.string().optional(),
  value: z.string().optional(),
  timestamp: z.number().optional(),
});

const SavedEntry = z.object({
  title: z.string().optional(),
  string_map_data: z.record(z.string(), StringMapValue).optional(),
});

const SavedPostsFile = z.object({
  saved_saved_media: z.array(SavedEntry).optional(),
  // Collections files use this key instead.
  saved_collections: z.array(SavedEntry).optional(),
});

export type InstagramSavedPost = {
  url: string;
  shortcode: string;
  author?: string;
  savedAt?: string;
  collection?: string;
};

function extractHrefAndTime(entry: z.infer<typeof SavedEntry>): {
  href?: string;
  timestamp?: number;
} {
  for (const value of Object.values(entry.string_map_data ?? {})) {
    if (value.href) return { href: value.href, timestamp: value.timestamp };
  }
  return {};
}

function shortcodeOf(url: string): string | undefined {
  const match = url.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/);
  return match?.[1];
}

/** Parses saved_posts.json. Unparseable entries are skipped, never fatal. */
export function parseSavedPosts(raw: unknown): InstagramSavedPost[] {
  const parsed = SavedPostsFile.safeParse(raw);
  if (!parsed.success) return [];

  const entries = parsed.data.saved_saved_media ?? parsed.data.saved_collections ?? [];
  const posts: InstagramSavedPost[] = [];

  for (const entry of entries) {
    const { href, timestamp } = extractHrefAndTime(entry);
    if (!href) continue;
    const shortcode = shortcodeOf(href);
    if (!shortcode) continue;

    posts.push({
      url: href,
      shortcode,
      author: entry.title?.trim() || undefined,
      savedAt: timestamp ? new Date(timestamp * 1000).toISOString() : undefined,
    });
  }

  return posts;
}

/**
 * Merges saved_collections.json onto posts by shortcode.
 *
 * The collection name is the single most valuable field in the whole export: it is a
 * topic label the user wrote themselves, which beats anything we could infer from a
 * caption. Losing it in the merge wastes the best signal in the file.
 */
export function mergeCollections(
  posts: InstagramSavedPost[],
  collectionsRaw: unknown,
): InstagramSavedPost[] {
  const parsed = SavedPostsFile.safeParse(collectionsRaw);
  if (!parsed.success) return posts;

  const entries = parsed.data.saved_collections ?? parsed.data.saved_saved_media ?? [];
  const byShortcode = new Map<string, string>();

  for (const entry of entries) {
    const { href } = extractHrefAndTime(entry);
    if (!href) continue;
    const shortcode = shortcodeOf(href);
    // In collections files the entry title carries the collection name.
    if (shortcode && entry.title) byShortcode.set(shortcode, entry.title.trim());
  }

  return posts.map((post) => ({
    ...post,
    collection: byShortcode.get(post.shortcode) ?? post.collection,
  }));
}

/** Accepts a newline-delimited list of permalinks, for a hand-built corpus. */
export function parsePermalinkList(text: string): InstagramSavedPost[] {
  const posts: InstagramSavedPost[] = [];
  for (const line of text.split("\n")) {
    const url = line.trim();
    if (!url || url.startsWith("#")) continue;
    const shortcode = shortcodeOf(url);
    if (!shortcode) continue;
    posts.push({ url, shortcode });
  }
  return posts;
}
