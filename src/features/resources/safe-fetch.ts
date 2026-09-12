import { lookup } from "node:dns/promises";
import { isBlockedHost } from "./canonicalize-url";
import { ResourceIngestionError } from "./types";

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const REQUEST_TIMEOUT_MS = 8000;

async function assertHostIsSafe(hostname: string): Promise<void> {
  if (isBlockedHost(hostname)) {
    throw new ResourceIngestionError("BLOCKED_DESTINATION", "That destination cannot be reached.");
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    throw new ResourceIngestionError("METADATA_UNAVAILABLE", "The destination host could not be resolved.");
  }

  for (const { address } of resolved) {
    if (isBlockedHost(address)) {
      throw new ResourceIngestionError("BLOCKED_DESTINATION", "That destination cannot be reached.");
    }
  }
}

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
};

/**
 * Fetches a user-supplied URL with SSRF protections: only http/https, blocks
 * loopback/private/link-local/metadata-range hosts (checked again against
 * every DNS resolution and every redirect hop), caps redirects, response
 * size, and request duration.
 *
 * Hackathon-scope limitation: the safety check and the actual TCP connect are
 * two separate steps (fetch resolves DNS again internally), so this narrows
 * but does not fully eliminate a DNS-rebinding race. Closing that gap needs a
 * custom dispatcher that pins the connection to the checked IP.
 */
export async function safeFetch(rawUrl: string): Promise<SafeFetchResult> {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const url = new URL(currentUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ResourceIngestionError("UNSUPPORTED_PROTOCOL", "Only http and https links can be fetched.");
    }

    await assertHostIsSafe(url.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "ResurfaceAI-LinkPreview/1.0" },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ResourceIngestionError("FETCH_TIMEOUT", "The link took too long to respond.");
      }
      throw new ResourceIngestionError("METADATA_UNAVAILABLE", "The link could not be reached.");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new ResourceIngestionError("METADATA_UNAVAILABLE", "The link redirected without a destination.");
      }
      currentUrl = new URL(location, url).toString();
      continue;
    }

    const contentType = response.headers.get("content-type");
    const body = await readBodyWithLimit(response);

    return { finalUrl: url.toString(), status: response.status, contentType, body };
  }

  throw new ResourceIngestionError("METADATA_UNAVAILABLE", "The link redirected too many times.");
}

async function readBodyWithLimit(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ResourceIngestionError("FETCH_TOO_LARGE", "The link's content was too large to read.");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}
