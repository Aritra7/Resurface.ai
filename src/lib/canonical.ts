/**
 * URL canonicalization for cross-platform deduplication.
 *
 * The same video can arrive as a YouTube like, a Chrome bookmark, and a shared short link.
 * All three must collapse to one resource row, which means they must produce one canonical_url.
 */

/** Tracking parameters that never change which document a URL points at. */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "dclid", "msclkid", "twclid", "mc_cid", "mc_eid",
  "igsh", "igshid", "si", "feature", "app", "ref", "ref_src", "ref_url",
  "share_id", "source", "spm", "scwx", "_branch_match_id",
]);

/** Params that ARE meaningful and must survive. */
const PRESERVED_PARAMS = new Set(["v", "list", "p", "id", "q", "page", "story_fbid"]);

export type CanonicalResult = {
  canonicalUrl: string;
  /** Platform-native id when we can recognise one: YouTube video id, Instagram shortcode. */
  externalId?: string;
  /** Detected platform, or "web". */
  platform: "youtube" | "instagram" | "reddit" | "web";
};

export function canonicalize(input: string): CanonicalResult | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Always https; http/https variants of one page are the same page.
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";

  const youtube = canonicalizeYouTube(url);
  if (youtube) return youtube;

  const instagram = canonicalizeInstagram(url);
  if (instagram) return instagram;

  const reddit = canonicalizeReddit(url);
  if (reddit) return reddit;

  stripTracking(url);
  return { canonicalUrl: stripTrailingSlash(url.toString()), platform: "web" };
}

function canonicalizeYouTube(url: URL): CanonicalResult | null {
  const host = url.hostname;
  let videoId: string | null = null;

  if (host === "youtu.be") {
    // Short link: youtu.be/VIDEOID
    videoId = url.pathname.slice(1).split("/")[0] || null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/shorts/")) {
      // Shorts and watch URLs for the same id are the same video.
      videoId = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] || null;
    } else if (url.pathname.startsWith("/live/")) {
      videoId = url.pathname.split("/")[2] || null;
    }
  } else {
    return null;
  }

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    // A YouTube URL we don't recognise (channel, playlist page). Treat generically.
    stripTracking(url);
    return { canonicalUrl: stripTrailingSlash(url.toString()), platform: "youtube" };
  }

  return {
    canonicalUrl: `https://youtube.com/watch?v=${videoId}`,
    externalId: videoId,
    platform: "youtube",
  };
}

function canonicalizeInstagram(url: URL): CanonicalResult | null {
  if (!url.hostname.endsWith("instagram.com")) return null;

  // /reel/SHORTCODE, /p/SHORTCODE, /tv/SHORTCODE all identify one post.
  const match = url.pathname.match(/^\/(reel|reels|p|tv)\/([\w-]+)/);
  if (!match) {
    stripTracking(url);
    return { canonicalUrl: stripTrailingSlash(url.toString()), platform: "instagram" };
  }

  const shortcode = match[2];
  // Normalise every variant to /p/, so a Reel saved twice under different paths dedupes.
  return {
    canonicalUrl: `https://instagram.com/p/${shortcode}`,
    externalId: shortcode,
    platform: "instagram",
  };
}

function canonicalizeReddit(url: URL): CanonicalResult | null {
  if (!url.hostname.endsWith("reddit.com")) return null;

  const match = url.pathname.match(/^\/r\/([\w-]+)\/comments\/(\w+)/);
  if (!match) {
    stripTracking(url);
    return { canonicalUrl: stripTrailingSlash(url.toString()), platform: "reddit" };
  }

  return {
    canonicalUrl: `https://reddit.com/r/${match[1]}/comments/${match[2]}`,
    externalId: `t3_${match[2]}`,
    platform: "reddit",
  };
}

function stripTracking(url: URL) {
  const toDelete: string[] = [];
  url.searchParams.forEach((_value, name) => {
    const lower = name.toLowerCase();
    if (TRACKING_PARAMS.has(lower) && !PRESERVED_PARAMS.has(lower)) {
      toDelete.push(name);
    }
  });
  for (const name of toDelete) url.searchParams.delete(name);
  url.searchParams.sort(); // Param order must not create distinct canonical forms.
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "").replace(/\/(\?)/, "$1");
}

/** Best-effort display hostname, used as `author` for generic web resources. */
export function hostnameOf(input: string): string | undefined {
  try {
    return new URL(input).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
