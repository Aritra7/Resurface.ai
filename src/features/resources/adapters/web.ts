import { safeFetch } from "../safe-fetch";
import { defaultEstimatedMinutes, estimateReadingMinutes } from "../estimate-duration";
import { ResourceIngestionError } from "../types";

const MAX_EXTRACTED_TEXT_LENGTH = 4000;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractAttr(tag: string, attr: string): string | undefined {
  const match = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  if (!match) return undefined;
  return decodeHtmlEntities(match[2] ?? match[3] ?? "");
}

export type HtmlMetadata = {
  canonical?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  title?: string;
  metaDescription?: string;
  text: string;
};

/** Minimal, dependency-free HTML metadata extraction. Order of preference is applied by the caller. */
export function parseHtmlMetadata(html: string): HtmlMetadata {
  const metaTags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  let ogTitle: string | undefined;
  let ogDescription: string | undefined;
  let ogImage: string | undefined;
  let metaDescription: string | undefined;

  for (const tag of metaTags) {
    const content = extractAttr(tag, "content");
    if (!content) continue;
    const property = extractAttr(tag, "property")?.toLowerCase();
    const name = extractAttr(tag, "name")?.toLowerCase();

    if (property === "og:title") ogTitle = content;
    else if (property === "og:description") ogDescription = content;
    else if (property === "og:image") ogImage = content;
    else if (name === "description") metaDescription = content;
  }

  const canonicalTagMatch = /<link\s+[^>]*rel\s*=\s*("canonical"|'canonical')[^>]*>/i.exec(html);
  const canonical = canonicalTagMatch ? extractAttr(canonicalTagMatch[0], "href") : undefined;

  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) || undefined : undefined;

  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const text = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { canonical, ogTitle, ogDescription, ogImage, title, metaDescription, text };
}

export type WebEnrichment = {
  canonicalUrl?: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  extractedText?: string;
  estimatedMinutes: number;
  warnings: string[];
};

export type WebPageFetcher = (url: string) => Promise<{ body: string; contentType: string | null }>;

async function defaultFetchPage(url: string): Promise<{ body: string; contentType: string | null }> {
  const result = await safeFetch(url);
  return { body: result.body, contentType: result.contentType };
}

/** Soft failures fall back to a link-only save; a blocked/unsafe destination is rethrown as a hard failure. */
function isSoftFailure(error: unknown): boolean {
  return (
    error instanceof ResourceIngestionError &&
    (error.code === "METADATA_UNAVAILABLE" ||
      error.code === "FETCH_TIMEOUT" ||
      error.code === "FETCH_TOO_LARGE" ||
      error.code === "UNSUPPORTED_PROTOCOL")
  );
}

export async function enrichWeb(url: string, deps: { fetchPage?: WebPageFetcher } = {}): Promise<WebEnrichment> {
  const fetchPage = deps.fetchPage ?? defaultFetchPage;

  let page: { body: string; contentType: string | null };
  try {
    page = await fetchPage(url);
  } catch (error) {
    if (isSoftFailure(error)) {
      return {
        estimatedMinutes: defaultEstimatedMinutes("article"),
        warnings: ["Could not read the page's details. Add a title or category."],
      };
    }
    throw error;
  }

  if (!page.contentType || !page.contentType.toLowerCase().includes("text/html")) {
    return {
      estimatedMinutes: defaultEstimatedMinutes("article"),
      warnings: ["This link is not a readable web page; saved with its address only."],
    };
  }

  const meta = parseHtmlMetadata(page.body);
  const title = meta.ogTitle || meta.title;
  const description = meta.ogDescription || meta.metaDescription;
  const wordCount = meta.text ? meta.text.split(/\s+/).filter(Boolean).length : 0;
  const estimatedMinutes = wordCount > 0 ? estimateReadingMinutes(wordCount) : defaultEstimatedMinutes("article");

  const warnings: string[] = [];
  let finalTitle = title;
  if (!finalTitle) {
    finalTitle = new URL(url).hostname;
    warnings.push("Could not find a title; used the site's hostname instead.");
  }

  return {
    canonicalUrl: meta.canonical,
    title: finalTitle,
    description,
    thumbnailUrl: meta.ogImage,
    extractedText: meta.text ? meta.text.slice(0, MAX_EXTRACTED_TEXT_LENGTH) : undefined,
    estimatedMinutes,
    warnings,
  };
}
