export type BookmarkImportEntry = {
  url: string;
  title?: string;
  folderPath?: string[];
  savedAt?: string;
};

const TOKEN_RE = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s+([^>]*)>([\s\S]*?)<\/A>|(<DL>)|(<\/DL>)/gi;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractAttr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
  if (!match) return undefined;
  return decodeHtmlEntities(match[2] ?? match[3] ?? "");
}

export type ParsedBookmarkFile = {
  entries: BookmarkImportEntry[];
  unsupportedCount: number;
};

/**
 * Dependency-free parser for a Netscape Bookmark HTML export (Chrome, Firefox,
 * Safari all use this format). Designed to run identically in the browser
 * (no DOMParser dependency) and in Node for unit tests. Only http/https
 * links are kept; other schemes (e.g. javascript:, place:) are counted as
 * unsupported and dropped.
 */
export function parseBookmarkHtml(html: string): ParsedBookmarkFile {
  const entries: BookmarkImportEntry[] = [];
  // null entries mark an unnamed nesting level (e.g. the root <DL>), which
  // must still be pushed/popped to keep depth tracking correct but should
  // not appear in a bookmark's folderPath.
  const folderStack: Array<string | null> = [];
  let pendingFolderName: string | null = null;
  let unsupportedCount = 0;

  for (const match of html.matchAll(TOKEN_RE)) {
    const [, h3Text, aAttrs, aText, dlOpen, dlClose] = match;

    if (h3Text !== undefined) {
      pendingFolderName = decodeHtmlEntities(h3Text.trim());
      continue;
    }

    if (dlOpen) {
      folderStack.push(pendingFolderName);
      pendingFolderName = null;
      continue;
    }

    if (dlClose) {
      folderStack.pop();
      continue;
    }

    if (aAttrs !== undefined) {
      const href = extractAttr(aAttrs, "href");
      if (!href || !/^https?:\/\//i.test(href)) {
        unsupportedCount += 1;
        continue;
      }

      const addDateSeconds = extractAttr(aAttrs, "add_date");
      const savedAt = addDateSeconds ? new Date(Number(addDateSeconds) * 1000) : null;
      const folderPath = folderStack.filter((name): name is string => name !== null);

      entries.push({
        url: href,
        title: decodeHtmlEntities(aText.trim()) || undefined,
        folderPath: folderPath.length > 0 ? folderPath : undefined,
        savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt.toISOString() : undefined,
      });
    }
  }

  return { entries, unsupportedCount };
}
