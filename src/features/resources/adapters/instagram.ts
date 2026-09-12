/**
 * Instagram enrichment. Instagram has no public consumer API for reading a
 * user's Saved collection or for reading Reel/post metadata without a
 * Meta-issued access token, so the supported path is: try the oEmbed endpoint
 * if an access token is configured, otherwise fall back to a clearly-labeled
 * placeholder title. This never scrapes the Saved page or uses an unofficial
 * downloader.
 */
export type InstagramEnrichment = {
  title: string;
  thumbnailUrl?: string;
  durationIsEstimated: boolean;
  warnings: string[];
};

export type InstagramFetcher = (url: string) => Promise<unknown>;

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

function fallbackTitle(kind: "reel" | "post"): string {
  return kind === "reel" ? "Instagram Reel" : "Instagram post";
}

export async function enrichInstagram(
  canonicalUrl: string,
  kind: "reel" | "post",
  deps: { fetcher?: InstagramFetcher; accessToken?: string } = {},
): Promise<InstagramEnrichment> {
  const accessToken = deps.accessToken ?? process.env.INSTAGRAM_ACCESS_TOKEN;

  if (accessToken) {
    const fetcher = deps.fetcher ?? fetchJson;
    const url = `https://graph.facebook.com/v19.0/instagram_oembed?url=${encodeURIComponent(canonicalUrl)}&access_token=${encodeURIComponent(accessToken)}`;
    const data = (await fetcher(url)) as { title?: string; thumbnail_url?: string } | null;

    if (data?.title || data?.thumbnail_url) {
      return {
        title: data.title?.trim() || fallbackTitle(kind),
        thumbnailUrl: data.thumbnail_url,
        durationIsEstimated: kind === "reel",
        warnings: [],
      };
    }
  }

  return {
    title: fallbackTitle(kind),
    durationIsEstimated: true,
    warnings: ["Could not retrieve Instagram metadata; add a note or category to help find this later."],
  };
}
