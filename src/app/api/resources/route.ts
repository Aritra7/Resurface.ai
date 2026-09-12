import { NextResponse } from "next/server";
import { canonicalize } from "@/lib/canonical";
import { createServerClient, getCurrentUser } from "@/lib/supabase/server";
import { saveResourceSchema } from "@/features/resources/manual-schema";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { message: "Sign in to save resources." } }, { status: 401 });

  const parsed = saveResourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: "That resource could not be saved." } }, { status: 400 });
  }

  const canonical = canonicalize(parsed.data.url);
  if (!canonical) {
    return NextResponse.json({ error: { message: "Enter a valid HTTP or HTTPS link." } }, { status: 400 });
  }

  const source = canonical.platform === "youtube" || canonical.platform === "instagram"
    ? canonical.platform
    : "web";
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("save_manual_resource", {
    p_url: parsed.data.url,
    p_canonical_url: canonical.canonicalUrl,
    p_source: source,
    p_content_type: parsed.data.contentType,
    p_title: parsed.data.title ?? null,
    p_description: parsed.data.description ?? null,
    p_user_note: parsed.data.userNote ?? null,
    p_thumbnail_url: parsed.data.thumbnailUrl ?? null,
    p_estimated_minutes: parsed.data.estimatedMinutes,
    p_external_id: canonical.externalId ?? null,
    p_categories: parsed.data.categories,
    p_cognitive_effort: parsed.data.cognitiveEffort,
    p_actionability: parsed.data.actionability,
    p_time_sensitivity: parsed.data.timeSensitivity,
    p_goal_matches: parsed.data.goalMatches,
  });

  if (error) {
    console.error("[manual resource]", error);
    return NextResponse.json({ error: { message: "That resource could not be saved." } }, { status: 500 });
  }

  return NextResponse.json({ resourceId: data, canonicalUrl: canonical.canonicalUrl }, { status: 201 });
}
