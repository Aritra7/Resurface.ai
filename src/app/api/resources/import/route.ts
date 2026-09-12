import { createClient } from "@/lib/supabase/server";
import { canonicalizeUrl } from "@/features/resources/canonicalize-url";
import { categorizeDeterministically } from "@/features/resources/categorize-resource";
import { buildNormalizedCandidate } from "@/features/resources/ingest-resource";
import { finalizeResourceCategorization, findResourceByCanonicalUrl, listActiveGoals, upsertResource } from "@/features/resources/repositories";
import { bookmarkImportRequestSchema } from "@/features/resources/schemas";
import { ResourceIngestionError } from "@/features/resources/types";

/**
 * Accepts a bounded batch of normalized bookmark candidates parsed client-side
 * from a Netscape Bookmark HTML export, and imports each through the same
 * normalization + categorization pipeline manual paste uses.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to import bookmarks." } }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bookmarkImportRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_URL", message: "That import batch could not be understood." } },
      { status: 400 },
    );
  }

  const goals = await listActiveGoals(supabase);

  let imported = 0;
  let duplicates = 0;
  let failed = 0;

  for (const entry of parsed.data.entries) {
    try {
      const canonical = canonicalizeUrl(entry.url, "browser_bookmark");
      const existing = await findResourceByCanonicalUrl(supabase, canonical.canonicalUrl);

      if (existing) {
        duplicates += 1;
        continue;
      }

      const candidate = await buildNormalizedCandidate({
        url: entry.url,
        suppliedTitle: entry.title,
        sourceHint: "browser_bookmark",
        importedAt: entry.savedAt,
        categoryHints: entry.folderPath,
      });

      const categorization = categorizeDeterministically({
        title: candidate.title,
        description: candidate.description,
        extractedText: candidate.extractedText,
        bookmarkFolderHint: entry.folderPath?.join(" "),
        contentType: candidate.contentType,
        goals,
      });

      const { resourceId } = await upsertResource(supabase, candidate, entry.url);
      await finalizeResourceCategorization(supabase, resourceId, categorization);
      imported += 1;
    } catch (error) {
      if (error instanceof ResourceIngestionError && error.code === "BLOCKED_DESTINATION") {
        failed += 1;
        continue;
      }
      console.error("bookmark import entry failed", error);
      failed += 1;
    }
  }

  return Response.json({
    totalParsed: parsed.data.entries.length,
    imported,
    duplicates,
    failed,
  });
}
