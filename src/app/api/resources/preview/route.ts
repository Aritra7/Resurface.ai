import { NextResponse } from "next/server";
import { canonicalize, hostnameOf } from "@/lib/canonical";
import { categorize, matchGoals } from "@/lib/categorize";
import { enrichUrl } from "@/lib/enrich";
import { createServerClient, getCurrentUser } from "@/lib/supabase/server";
import { previewResourceSchema, type ResourceContentType } from "@/features/resources/manual-schema";

function sourceFor(platform: string): "youtube" | "instagram" | "web" {
  return platform === "youtube" || platform === "instagram" ? platform : "web";
}

function contentTypeFor(source: string, hint?: string): ResourceContentType {
  if (hint && ["short_video", "video", "social_post", "article", "newsletter", "other"].includes(hint)) {
    return hint as ResourceContentType;
  }
  return source === "youtube" ? "video" : "article";
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { message: "Sign in to save resources." } }, { status: 401 });

  const parsed = previewResourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "Enter a valid HTTP or HTTPS link." } }, { status: 400 });
  }

  const canonical = canonicalize(parsed.data.url);
  if (!canonical) {
    return NextResponse.json({ error: { message: "Enter a valid HTTP or HTTPS link." } }, { status: 400 });
  }

  const source = sourceFor(canonical.platform);
  const contentType = contentTypeFor(source, canonical.contentHint);
  const supabase = await createServerClient();
  const [{ data: existing }, { data: goals }, enrichment] = await Promise.all([
    supabase.from("resources").select("id").eq("canonical_url", canonical.canonicalUrl).maybeSingle(),
    supabase.from("goals").select("id, name").eq("active", true),
    enrichUrl(canonical.canonicalUrl, source),
  ]);

  const estimatedMinutes = enrichment?.durationSeconds
    ? Math.max(1, Math.ceil(enrichment.durationSeconds / 60))
    : contentType === "short_video" || contentType === "social_post"
      ? 1
      : contentType === "video"
        ? 8
        : 5;
  const title = enrichment?.title ?? hostnameOf(parsed.data.url) ?? "Untitled save";
  const classification = categorize({
    title,
    description: enrichment?.description,
    collection: parsed.data.userNote,
    url: canonical.canonicalUrl,
    source,
    contentType,
    estimatedMinutes,
  });
  const goalMatches = matchGoals(classification.categories, (goals ?? []) as Array<{ id: string; name: string }>);

  return NextResponse.json({
    candidate: {
      originalUrl: parsed.data.url,
      canonicalUrl: canonical.canonicalUrl,
      source,
      contentType,
      title,
      description: enrichment?.description,
      thumbnailUrl: enrichment?.thumbnailUrl,
      estimatedMinutes,
    },
    suggestions: { ...classification, goalMatches },
    duplicate: existing ? { resourceId: existing.id } : null,
    warnings: enrichment ? [] : ["We could not read this page's details. You can still save and label it."],
  });
}
