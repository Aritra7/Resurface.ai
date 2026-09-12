import { z } from "zod";

export const resourceSourceSchema = z.enum(["instagram", "youtube", "gmail", "browser_bookmark", "web"]);

export const resourceContentTypeSchema = z.enum([
  "short_video",
  "video",
  "social_post",
  "article",
  "newsletter",
  "other",
]);

/** Request body for POST /api/resources/preview */
export const ingestionInputSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  userNote: z.string().trim().max(500).optional(),
  suppliedTitle: z.string().trim().max(300).optional(),
  sourceHint: resourceSourceSchema.optional(),
  categoryHints: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
  importedAt: z.string().datetime().optional(),
});

export type IngestionInputPayload = z.infer<typeof ingestionInputSchema>;

const categoryLabelSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Category slug must be lowercase kebab-case"),
  label: z.string().trim().min(1).max(60),
  confidence: z.number().min(0).max(1),
});

const goalMatchSchema = z.object({
  goalId: z.string().uuid(),
  relevance: z.number().min(0).max(1),
  reason: z.string().trim().max(300),
});

/** Validates both the deterministic pass output and any AI-produced JSON before it can reach the database. */
export const categorizationResultSchema = z.object({
  summary: z.string().trim().max(400).optional(),
  categories: z.array(categoryLabelSchema).max(3),
  goalMatches: z.array(goalMatchSchema).max(10),
  cognitiveEffort: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  timeSensitivity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

/** Shape requested from an AI classifier, before goalId/slug cross-checks are applied against the caller's own data. */
export const aiCategorizationResponseSchema = z.object({
  summary: z.string().trim().max(400).optional(),
  categories: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(40),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(3),
  goalRelevance: z
    .array(
      z.object({
        goalId: z.string().min(1).max(100),
        relevance: z.number().min(0).max(1),
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .max(10),
  cognitiveEffort: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  timeSensitivity: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});

/** Request body for POST /api/resources: the (possibly user-edited) preview, confirmed for saving. */
export const confirmResourceSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  userNote: z.string().trim().max(500).optional(),
  sourceHint: resourceSourceSchema.optional(),
  title: z.string().trim().max(300).optional(),
  description: z.string().trim().max(2000).optional(),
  summary: z.string().trim().max(400).optional(),
  thumbnailUrl: z.string().trim().url().max(2048).optional(),
  contentType: resourceContentTypeSchema.optional(),
  estimatedMinutes: z.number().int().min(1).max(600).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  durationIsEstimated: z.boolean().optional(),
  categories: z.array(categoryLabelSchema).max(5).optional(),
  goalMatches: z.array(z.object({ goalId: z.string().uuid(), relevance: z.number().min(0).max(1) })).max(10).optional(),
  cognitiveEffort: z.number().min(0).max(1).optional(),
  actionability: z.number().min(0).max(1).optional(),
  timeSensitivity: z.number().min(0).max(1).optional(),
});

export type ConfirmResourcePayload = z.infer<typeof confirmResourceSchema>;

/** One row parsed from a Netscape bookmark HTML export, sent to POST /api/resources/import in bounded batches. */
export const bookmarkImportEntrySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().max(300).optional(),
  folderPath: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  savedAt: z.string().datetime().optional(),
});

export const bookmarkImportRequestSchema = z.object({
  entries: z.array(bookmarkImportEntrySchema).min(1).max(50),
});

export type BookmarkImportEntry = z.infer<typeof bookmarkImportEntrySchema>;
