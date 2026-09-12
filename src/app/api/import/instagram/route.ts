/**
 * Instagram import.
 *
 * Accepts the Saved files from Instagram's "Download your information" export:
 * saved_posts.json on its own, plus optionally saved_collections.json, or a plain
 * newline-delimited list of permalinks.
 *
 * No credentials are involved. Instagram has no Saved API at any tier, and we do not
 * scrape — see PRODUCT_FLOW.md section 11.
 */
import { NextResponse } from "next/server";
import { createOwnDataClient, getCurrentUser } from "@/lib/supabase/server";
import {
  mergeCollections,
  parsePermalinkList,
  parseSavedPosts,
  type InstagramSavedPost,
} from "@/lib/connectors/instagram";
import { finishSyncRun, ingestItems, startSyncRun, type IngestItem } from "@/lib/ingest";

/** Uploads are user-controlled: cap the size so a huge file cannot exhaust memory. */
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_BYTES) {
    return NextResponse.json({ error: "Files are too large (20 MB limit)." }, { status: 413 });
  }

  // Read every file first, then decide which is posts and which is collections, so the
  // user can drop both in together in either order.
  let posts: InstagramSavedPost[] = [];
  let collectionsRaw: unknown = null;
  const warnings: string[] = [];

  for (const file of files) {
    const text = await file.text();
    const name = file.name.toLowerCase();

    if (name.endsWith(".json") || text.trimStart().startsWith("{")) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        warnings.push(`${file.name} is not valid JSON and was skipped.`);
        continue;
      }

      if (name.includes("collection")) {
        collectionsRaw = json;
      } else {
        const parsed = parseSavedPosts(json);
        if (parsed.length === 0) warnings.push(`No saved posts found in ${file.name}.`);
        posts.push(...parsed);
      }
    } else {
      // Plain permalink list.
      const parsed = parsePermalinkList(text);
      if (parsed.length === 0) warnings.push(`No Instagram links found in ${file.name}.`);
      posts.push(...parsed);
    }
  }

  if (collectionsRaw) posts = mergeCollections(posts, collectionsRaw);

  if (posts.length === 0) {
    return NextResponse.json(
      {
        error:
          "No saved Instagram posts were found. Upload saved_posts.json from your Instagram data export, or a text file of Reel links.",
        warnings,
      },
      { status: 400 },
    );
  }

  // Falls back to the caller's RLS-scoped session when no server key is configured.
  // Instagram import only writes the user's own resources, which RLS already permits,
  // so this route keeps working on a deployment missing SUPABASE_SECRET_KEY.
  const supabase = await createOwnDataClient();
  const runId = await startSyncRun(supabase, user.id, "instagram");

  try {
    const items: IngestItem[] = posts.map((post) => ({
      url: post.url,
      source: "instagram",
      externalId: post.shortcode,
      // The export carries no caption, so title stays unset and enrichment_status
      // stays "pending" — the link is preserved either way, per contract section 9.
      author: post.author,
      collection: post.collection ?? "Saved posts",
      savedAt: post.savedAt,
    }));

    const result = await ingestItems(supabase, user.id, items);
    await finishSyncRun(supabase, runId, result);

    return NextResponse.json({
      ok: true,
      seen: result.seen,
      imported: result.inserted,
      skipped: result.skipped,
      warnings,
    });
  } catch (error) {
    const message = (error as Error).message;
    console.error("[instagram import]", message);
    await finishSyncRun(supabase, runId, { seen: 0, inserted: 0 }, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
