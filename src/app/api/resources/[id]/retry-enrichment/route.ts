import { createClient } from "@/lib/supabase/server";
import { buildNormalizedCandidate } from "@/features/resources/ingest-resource";
import { categorizeDeterministically } from "@/features/resources/categorize-resource";
import {
  finalizeResourceCategorization,
  getResourceById,
  listActiveGoals,
  markResourceEnrichmentFailed,
  retryResourceEnrichment,
} from "@/features/resources/repositories";
import { ResourceIngestionError } from "@/features/resources/types";

export async function POST(_request: Request, context: RouteContext<"/api/resources/[id]/retry-enrichment">) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to retry enrichment." } }, { status: 401 });
  }

  const resource = await getResourceById(supabase, id);
  if (!resource) {
    return Response.json({ error: { code: "INVALID_URL", message: "Resource not found." } }, { status: 404 });
  }

  try {
    await retryResourceEnrichment(supabase, id);
  } catch {
    return Response.json(
      { error: { code: "INVALID_URL", message: "Only a failed resource can be retried." } },
      { status: 409 },
    );
  }

  try {
    const candidate = await buildNormalizedCandidate({ url: resource.url, userNote: resource.userNote ?? undefined });
    const goals = await listActiveGoals(supabase);
    const categorization = categorizeDeterministically({
      title: candidate.title,
      description: candidate.description,
      extractedText: candidate.extractedText,
      userNote: candidate.userNote,
      contentType: candidate.contentType,
      goals,
    });

    await finalizeResourceCategorization(supabase, id, categorization);
    return Response.json({ resourceId: id, status: "complete" });
  } catch (error) {
    await markResourceEnrichmentFailed(
      supabase,
      id,
      error instanceof ResourceIngestionError ? error.code : "METADATA_UNAVAILABLE",
    ).catch(() => undefined);

    return Response.json(
      { error: { code: "METADATA_UNAVAILABLE", message: "We still could not read this link's details." } },
      { status: 502 },
    );
  }
}
