import { createClient } from "@/lib/supabase/server";
import { canonicalizeUrl } from "@/features/resources/canonicalize-url";
import { buildResourcePreview } from "@/features/resources/ingest-resource";
import { findResourceByCanonicalUrl, listActiveGoals } from "@/features/resources/repositories";
import { ingestionInputSchema } from "@/features/resources/schemas";
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
  const parsed = ingestionInputSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_URL", message: "That request could not be understood." } },
      { status: 400 },
    );
  }

  try {
    const canonical = canonicalizeUrl(parsed.data.url, parsed.data.sourceHint);
    const [existingResource, goals] = await Promise.all([
      findResourceByCanonicalUrl(supabase, canonical.canonicalUrl),
      listActiveGoals(supabase),
    ]);

    const duplicate = existingResource ? { resourceId: existingResource.id } : null;
    const preview = await buildResourcePreview(parsed.data, goals, duplicate);
    return Response.json(preview);
  } catch (error) {
    if (error instanceof ResourceIngestionError) {
      const status = CLIENT_ERROR_CODES.has(error.code) ? 400 : 502;
      return Response.json({ error: { code: error.code, message: error.message } }, { status });
    }

    console.error("resource preview failed", error);
    return Response.json(
      { error: { code: "METADATA_UNAVAILABLE", message: "We could not check that link right now." } },
      { status: 502 },
    );
  }
}
