import { NextResponse } from "next/server";
import { updateResourceSchema } from "@/features/resources/manual-schema";
import { createServerClient, getCurrentUser } from "@/lib/supabase/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { message: "Sign in to edit resources." } }, { status: 401 });
  const { id } = await params;
  const parsedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const parsed = updateResourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId || !parsed.success) return NextResponse.json({ error: { message: "Those resource details are invalid." } }, { status: 400 });

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("update_resource_details", {
    p_resource_id: id,
    p_title: parsed.data.title,
    p_user_note: parsed.data.userNote,
    p_content_type: parsed.data.contentType,
    p_estimated_minutes: parsed.data.estimatedMinutes,
    p_categories: parsed.data.categories,
    p_cognitive_effort: parsed.data.cognitiveEffort,
    p_actionability: parsed.data.actionability,
    p_time_sensitivity: parsed.data.timeSensitivity,
    p_status: parsed.data.status,
    p_goal_matches: parsed.data.goalMatches,
  });
  if (error) {
    console.error("[resource update]", error);
    return NextResponse.json({ error: { message: "That resource could not be updated." } }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
