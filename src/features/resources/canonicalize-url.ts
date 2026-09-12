import { isIP } from "node:net";
import { ResourceIngestionError, type ResourceContentType, type ResourceSource } from "./types";

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAM_NAMES = new Set([
  "fbclid",
  "gclid",
  "igsh",
  "igshid",
  "si",
  "ref",
  "ref_src",
  "ref_url",
  "spm",
  "mc_cid",
  "mc_eid",
]);

/** Query params whose value identifies the content itself and must survive canonicalization. */
const CONTENT_IDENTIFYING_PARAMS: Record<string, Set<string>> = {
  "youtube.com": new Set(["v"]),
  "www.youtube.com": new Set(["v"]),
  "m.youtube.com": new Set(["v"]),
};

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKING_PARAM_NAMES.has(lower) || TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Blocks loopback, private, link-local, and metadata-service address ranges.
 * Used both at submit time (literal IP hosts) and by the fetch layer against every resolved/redirect destination.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(host);

  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets;
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }

  if (ipVersion === 6) {
    if (host === "::1" || host === "::") return true;
    if (host.startsWith("fe80:") || host.startsWith("fe80::")) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // unique local fc00::/7
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice("::ffff:".length);
      if (isIP(mapped) === 4) return isBlockedHost(mapped);
    }
    return false;
  }

  return false;
}

function parseUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new ResourceIngestionError("INVALID_URL", "That does not look like a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ResourceIngestionError("UNSUPPORTED_PROTOCOL", "Only http and https links can be saved.");
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new ResourceIngestionError("BLOCKED_DESTINATION", "That destination cannot be saved.");
  }

  return parsed;
}

function stripTrackingParams(url: URL): void {
  const keep = CONTENT_IDENTIFYING_PARAMS[url.hostname.toLowerCase()];
  const toDelete: string[] = [];

  url.searchParams.forEach((_value, name) => {
    if (keep?.has(name)) return;
    if (isTrackingParam(name)) toDelete.push(name);
  });

  for (const name of toDelete) {
    url.searchParams.delete(name);
  }
}

function removeDefaultPort(url: URL): void {
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
}

function basicNormalize(url: URL): URL {
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  removeDefaultPort(url);
  stripTrackingParams(url);
  return url;
}

type YoutubeMatch = { videoId: string; isShort: boolean };

function matchYoutube(url: URL): YoutubeMatch | null {
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");

  if (host === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    return videoId ? { videoId, isShort: false } : null;
  }

  if (host !== "youtube.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] === "shorts" && segments[1]) {
    return { videoId: segments[1], isShort: true };
  }

  if (segments[0] === "embed" && segments[1]) {
    return { videoId: segments[1], isShort: false };
  }

  if (segments[0] === "watch") {
    const videoId = url.searchParams.get("v");
    return videoId ? { videoId, isShort: false } : null;
  }

  return null;
}

type InstagramMatch = { externalId: string; kind: "reel" | "post" };

function matchInstagram(url: URL): InstagramMatch | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "reel" && segments[1]) {
    return { externalId: segments[1], kind: "reel" };
  }
  if (segments[0] === "p" && segments[1]) {
    return { externalId: segments[1], kind: "post" };
  }
  return null;
}

export type CanonicalizationResult = {
  canonicalUrl: string;
  source: ResourceSource;
  contentType: ResourceContentType;
  externalId?: string;
};

/**
 * Deterministic, table-tested URL validation + canonicalization + source/content-type
 * identification. Must not perform network access — that belongs to the enrichment adapters.
 */
export function canonicalizeUrl(rawUrl: string, sourceHint?: ResourceSource): CanonicalizationResult {
  const url = basicNormalize(parseUrl(rawUrl));

  const youtube = matchYoutube(url);
  if (youtube) {
    const canonical = new URL("https://www.youtube.com/watch");
    canonical.searchParams.set("v", youtube.videoId);
    return {
      canonicalUrl: canonical.toString(),
      source: "youtube",
      contentType: youtube.isShort ? "short_video" : "video",
      externalId: youtube.videoId,
    };
  }

  const instagram = matchInstagram(url);
  if (instagram) {
    const canonical = new URL(`https://www.instagram.com/${instagram.kind}/${instagram.externalId}/`);
    return {
      canonicalUrl: canonical.toString(),
      source: "instagram",
      contentType: instagram.kind === "reel" ? "short_video" : "social_post",
      externalId: instagram.externalId,
    };
  }

  return {
    canonicalUrl: url.toString(),
    source: sourceHint ?? "web",
    contentType: "article",
  };
}
