/**
 * YouTube enrichment. Destination hosts here (youtube.com, googleapis.com) are
 * fixed by us, not attacker-controlled, so this calls fetch directly rather
 * than through the SSRF-guarded safeFetch used for arbitrary user URLs.
 */
export type YoutubeEnrichment = {
  title?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  durationIsEstimated: boolean;
  warnings: string[];
};

export type YoutubeFetcher = (url: string) => Promise<unknown>;

const REQUEST_TIMEOUT_MS = 5000;

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** ISO 8601 duration like PT4M13S -> seconds. */
export function parseIso8601Duration(value: string): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return (Number(hours ?? 0) * 3600) + (Number(minutes ?? 0) * 60) + Number(seconds ?? 0);
}

async function fetchFromDataApi(videoId: string, apiKey: string, fetcher: YoutubeFetcher): Promise<YoutubeEnrichment | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}&part=snippet,contentDetails&key=${encodeURIComponent(apiKey)}`;
  const data = (await fetcher(url)) as {
    items?: Array<{
      snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } };
      contentDetails?: { duration?: string };
    }>;
  } | null;

  const item = data?.items?.[0];
  if (!item) return null;

  const durationSeconds = item.contentDetails?.duration ? parseIso8601Duration(item.contentDetails.duration) : null;

  return {
    title: item.snippet?.title,
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url,
    durationSeconds: durationSeconds ?? undefined,
    durationIsEstimated: false,
    warnings: [],
  };
}

async function fetchFromOembed(canonicalUrl: string, fetcher: YoutubeFetcher): Promise<YoutubeEnrichment | null> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
  const data = (await fetcher(url)) as { title?: string; thumbnail_url?: string } | null;

  if (!data) return null;

  return {
    title: data.title,
    thumbnailUrl: data.thumbnail_url,
    durationIsEstimated: true,
    warnings: ["Duration is estimated: oEmbed does not report video duration."],
  };
}

export async function enrichYoutube(
  videoId: string,
  canonicalUrl: string,
  deps: { fetcher?: YoutubeFetcher; apiKey?: string } = {},
): Promise<YoutubeEnrichment> {
  const fetcher = deps.fetcher ?? fetchJson;
  const apiKey = deps.apiKey ?? process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    const result = await fetchFromDataApi(videoId, apiKey, fetcher);
    if (result) return result;
  }

  const oembedResult = await fetchFromOembed(canonicalUrl, fetcher);
  if (oembedResult) return oembedResult;

  return {
    durationIsEstimated: true,
    warnings: ["Could not retrieve YouTube metadata; saved as a link-only resource."],
  };
}
