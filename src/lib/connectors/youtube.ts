/**
 * YouTube Data API v3 connector.
 *
 * What "saved" means on YouTube, and what is actually reachable:
 *
 *   Liked videos  -> playlist id "LL". This is the real saved signal.
 *   Playlists     -> playlists.list(mine=true), then playlistItems per playlist.
 *   Watch Later   -> playlist id "WL". NOT ACCESSIBLE. Third-party read access was
 *                    removed in 2016 and has never returned. Do not add it.
 *
 * Quota: 10,000 units/day. Every call used here costs 1 unit per request (50 items per
 * page), so a 500-item account syncs for ~30 units. `search.list` costs 100 and is never
 * used. Quota is effectively a non-issue at demo scale.
 */
import "server-only";
import { serverEnv } from "../env";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE = "https://www.googleapis.com/youtube/v3";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "openid",
  "email",
];

export function redirectUri(): string {
  return `${serverEnv.appUrl}/api/connect/youtube/callback`;
}

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: serverEnv.googleClientId ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // Both are required to actually receive a refresh token. Without prompt=consent,
    // Google returns one only on the very first authorization ever, so re-connecting
    // silently yields no refresh token and day-two sync breaks.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: serverEnv.googleClientId ?? "",
      client_secret: serverEnv.googleClientSecret ?? "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: serverEnv.googleClientId ?? "",
      client_secret: serverEnv.googleClientSecret ?? "",
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

/** Disconnect must actually revoke upstream, not merely delete our row. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(OAUTH_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => {
    // A revoke failure should not block local disconnect.
  });
}

// ---------------------------------------------------------------------------
// Data API
// ---------------------------------------------------------------------------

async function api<T>(path: string, accessToken: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
}

export type YouTubeVideo = {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  thumbnailUrl?: string;
  durationSeconds: number;
  publishedAt?: string;
  /** When the user added it to the playlist — the real "saved at". */
  savedAt?: string;
  collection: string;
};

type PlaylistItemsResponse = {
  nextPageToken?: string;
  items: Array<{
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      videoOwnerChannelTitle?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url: string }>;
      resourceId: { kind: string; videoId: string };
    };
  }>;
};

type VideosResponse = {
  items: Array<{
    id: string;
    snippet: { title: string; description: string; channelTitle: string; publishedAt: string;
               thumbnails?: Record<string, { url: string }> };
    contentDetails: { duration: string };
  }>;
};

/** ISO-8601 duration (PT1H2M3S) to seconds. */
export function parseDuration(iso: string): number {
  const match = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return (
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Math.round(Number(s ?? 0))
  );
}

function bestThumbnail(thumbs?: Record<string, { url: string }>): string | undefined {
  if (!thumbs) return undefined;
  return (thumbs.maxres ?? thumbs.standard ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url;
}

/** Pages through one playlist. 1 quota unit per page of 50. */
async function fetchPlaylistItems(
  accessToken: string,
  playlistId: string,
  collectionName: string,
  maxItems: number,
): Promise<YouTubeVideo[]> {
  const collected: YouTubeVideo[] = [];
  let pageToken: string | undefined;

  do {
    const page: PlaylistItemsResponse = await api("playlistItems", accessToken, {
      part: "snippet",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });

    for (const item of page.items ?? []) {
      const { snippet } = item;
      if (snippet.resourceId?.kind !== "youtube#video") continue;
      // Deleted and private videos remain in playlists as tombstones.
      if (snippet.title === "Deleted video" || snippet.title === "Private video") continue;

      collected.push({
        videoId: snippet.resourceId.videoId,
        title: snippet.title,
        description: snippet.description ?? "",
        channelTitle: snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? "",
        thumbnailUrl: bestThumbnail(snippet.thumbnails),
        durationSeconds: 0, // filled in by hydrateDurations
        savedAt: snippet.publishedAt,
        collection: collectionName,
      });
    }

    pageToken = page.nextPageToken;
  } while (pageToken && collected.length < maxItems);

  return collected.slice(0, maxItems);
}

/**
 * playlistItems does not return duration, so hydrate in batches of 50 ids.
 * Duration is the single most important field for a time-budgeted optimizer,
 * which is why this second pass is worth the extra quota.
 */
async function hydrateDurations(accessToken: string, videos: YouTubeVideo[]): Promise<void> {
  const byId = new Map(videos.map((v) => [v.videoId, v]));
  const ids = [...byId.keys()];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const response: VideosResponse = await api("videos", accessToken, {
      part: "contentDetails,snippet",
      id: batch.join(","),
      maxResults: "50",
    });

    for (const item of response.items ?? []) {
      const video = byId.get(item.id);
      if (!video) continue;
      video.durationSeconds = parseDuration(item.contentDetails.duration);
      if (!video.thumbnailUrl) video.thumbnailUrl = bestThumbnail(item.snippet.thumbnails);
      if (!video.channelTitle) video.channelTitle = item.snippet.channelTitle;
      video.publishedAt = item.snippet.publishedAt;
    }
  }
}

type PlaylistsResponse = {
  nextPageToken?: string;
  items: Array<{ id: string; snippet: { title: string }; contentDetails: { itemCount: number } }>;
};

export type SyncOptions = {
  includeLikes?: boolean;
  includePlaylists?: boolean;
  maxPerPlaylist?: number;
  maxTotal?: number;
};

/** Pulls liked videos and playlist contents, then hydrates durations. */
export async function fetchSavedVideos(
  accessToken: string,
  options: SyncOptions = {},
): Promise<YouTubeVideo[]> {
  const {
    includeLikes = true,
    includePlaylists = true,
    maxPerPlaylist = 200,
    maxTotal = 500,
  } = options;

  const all: YouTubeVideo[] = [];

  if (includeLikes) {
    try {
      all.push(...(await fetchPlaylistItems(accessToken, "LL", "Liked videos", maxPerPlaylist)));
    } catch (error) {
      // An empty or disabled likes playlist should not abort the whole sync.
      console.warn("[youtube] liked videos unavailable:", (error as Error).message);
    }
  }

  if (includePlaylists && all.length < maxTotal) {
    const playlists: PlaylistsResponse = await api("playlists", accessToken, {
      part: "snippet,contentDetails",
      mine: "true",
      maxResults: "50",
    });

    for (const playlist of playlists.items ?? []) {
      if (all.length >= maxTotal) break;
      if (playlist.contentDetails.itemCount === 0) continue;
      try {
        all.push(
          ...(await fetchPlaylistItems(
            accessToken,
            playlist.id,
            playlist.snippet.title,
            Math.min(maxPerPlaylist, maxTotal - all.length),
          )),
        );
      } catch (error) {
        console.warn(`[youtube] playlist ${playlist.id} failed:`, (error as Error).message);
      }
    }
  }

  // One video can sit in several playlists. Keep the first occurrence, which is
  // "Liked videos" when present — the strongest saved signal.
  const deduped = new Map<string, YouTubeVideo>();
  for (const video of all) {
    if (!deduped.has(video.videoId)) deduped.set(video.videoId, video);
  }
  const unique = [...deduped.values()].slice(0, maxTotal);

  await hydrateDurations(accessToken, unique);
  return unique;
}

/** Channel title of the connected account, for display on /connections. */
export async function fetchChannelIdentity(
  accessToken: string,
): Promise<{ id?: string; label?: string }> {
  try {
    const response: { items?: Array<{ id: string; snippet: { title: string } }> } = await api(
      "channels",
      accessToken,
      { part: "snippet", mine: "true", maxResults: "1" },
    );
    const channel = response.items?.[0];
    return { id: channel?.id, label: channel?.snippet?.title };
  } catch {
    return {};
  }
}
