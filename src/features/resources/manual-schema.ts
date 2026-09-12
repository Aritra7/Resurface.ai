import { z } from "zod";
import { CATEGORIES } from "@/lib/categorize";

export const resourceContentTypes = [
  "short_video",
  "video",
  "social_post",
  "article",
  "newsletter",
  "other",
] as const;

export type ResourceContentType = (typeof resourceContentTypes)[number];

export const previewResourceSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  userNote: z.string().trim().max(500).optional(),
});

export const saveResourceSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(4000).optional(),
  userNote: z.string().trim().max(500).optional(),
  thumbnailUrl: z.string().url().max(2048).optional(),
  contentType: z.enum(resourceContentTypes),
  estimatedMinutes: z.number().int().min(1).max(240),
  categories: z.array(z.enum(CATEGORIES)).max(3),
  goalMatches: z.array(z.object({
    goalId: z.string().uuid(),
    relevance: z.number().min(0).max(1),
  })).max(10),
  cognitiveEffort: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  timeSensitivity: z.number().min(0).max(1),
});

export const bookmarkImportSchema = z.object({
  entries: z.array(z.object({
    url: z.string().trim().min(1).max(2048),
    title: z.string().trim().max(500).optional(),
    folderPath: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
    savedAt: z.string().datetime().optional(),
  })).min(1).max(100),
});
