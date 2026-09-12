import { createClient } from "@/lib/supabase/server";
import { canonicalizeUrl } from "@/features/resources/canonicalize-url";
import { categorizeDeterministically } from "@/features/resources/categorize-resource";
import { defaultEstimatedMinutes } from "@/features/resources/estimate-duration";
import {
  finalizeResourceCategorization,
  listActiveGoals,
  markResourceEnrichmentFailed,
  upsertResource,
} from "@/features/resources/repositories";
import { confirmResourceSchema } from "@/features/resources/schemas";
import type { CategorizationResult } from "@/features/resources/types";
import { ResourceIngestionError } from "@/features/resources/types";

const CLIENT_ERROR_CODES = new Set(["INVALID_URL", "UNSUPPORTED_PROTOCOL", "BLOCKED_DESTINATION"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to save resources." } }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = confirmResourceSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_URL", message: "That request could not be understood." } },
      { status: 400 },
    );
  }

  const payload = parsed.data;

  let canonical: ReturnType<typeof canonicalizeUrl>;
  try {
    canonical = canonicalizeUrl(payload.url, payload.sourceHint);
  } catch (error) {
    if (error instanceof ResourceIngestionError) {
      const status = CLIENT_ERROR_CODES.has(error.code) ? 400 : 502;
      return Response.json({ error: { code: error.code, message: error.message } }, { status });
    }
    throw error;
  }

  const contentType = payload.contentType ?? canonical.contentType;
  const estimatedMinutes = payload.estimatedMinutes ?? defaultEstimatedMinutes(contentType);

  const { resourceId } = await upsertResource(
    supabase,
    {
      canonicalUrl: canonical.canonicalUrl,
      source: canonical.source,
      contentType,
      title: payload.title,
      description: payload.description,
      userNote: payload.userNote,
      estimatedMinutes,
      externalId: canonical.externalId,
      thumbnailUrl: payload.thumbnailUrl,
      durationSeconds: payload.durationSeconds,
      durationIsEstimated: payload.durationIsEstimated ?? true,
    },
    payload.url,
  );

  let categorization: CategorizationResult;
  if (payload.categories && payload.categories.length > 0) {
    categorization = {
      summary: payload.summary,
      categories: payload.categories,
      goalMatches: (payload.goalMatches ?? []).map((match) => ({ ...match, reason: "Confirmed by user" })),
      cognitiveEffort: payload.cognitiveEffort ?? 0.4,
      actionability: payload.actionability ?? 0.4,
      timeSensitivity: payload.timeSensitivity ?? 0.2,
      confidence: 1,
    };
  } else {
    // No preview was run (e.g. a quick manual save) — categorize now so the
    // resource never sits without at least a fallback category.
    const goals = await listActiveGoals(supabase);
    categorization = categorizeDeterministically({
      title: payload.title,
      description: payload.description,
      userNote: payload.userNote,
      contentType,
      goals,
    });
  }

  try {
    await finalizeResourceCategorization(supabase, resourceId, categorization);
  } catch (error) {
    console.error("finalizing resource categorization failed", error);
    await markResourceEnrichmentFailed(supabase, resourceId, "AI_OUTPUT_INVALID").catch(() => undefined);
    return Response.json(
      {
        error: {
          code: "AI_OUTPUT_INVALID",
          message: "We saved the link, but could not finish categorizing it. Try again from the backlog.",
        },
        resourceId,
      },
      { status: 502 },
    );
  }

  return Response.json({ resourceId, canonicalUrl: canonical.canonicalUrl }, { status: 201 });
}
