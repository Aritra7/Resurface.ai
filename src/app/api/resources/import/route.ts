import { NextResponse } from "next/server";
import { bookmarkImportSchema } from "@/features/resources/manual-schema";
import { createServerClient, getCurrentUser } from "@/lib/supabase/server";
import { ingestItems, type IngestItem } from "@/lib/ingest";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { message: "Sign in to import bookmarks." } }, { status: 401 });

  const parsed = bookmarkImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "That bookmark batch could not be read." } }, { status: 400 });
  }

  // Bookmark files can contain hundreds of links. Do not enrich each one inside this
  // request: that made the alternate implementation take minutes and exceed deployment
  // timeouts. Ingest titles/folders now; the bounded enrichment worker fills gaps later.
  const items: IngestItem[] = parsed.data.entries.map((entry) => ({
    url: entry.url,
    source: "browser_bookmark",
    title: entry.title,
    collection: entry.folderPath?.join(" / ") ?? "Imported bookmarks",
    savedAt: entry.savedAt,
  }));
  // Use the caller-scoped client so RLS remains in force; manual imports need no service key.
  const result = await ingestItems(await createServerClient(), user.id, items);

  return NextResponse.json({
    totalParsed: result.seen,
    imported: result.inserted,
    duplicates: result.skipped,
    failed: 0,
  });
}
