"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { parseBookmarkHtml } from "@/features/resources/adapters/bookmark-import";
import { CATEGORIES, type Category } from "@/lib/categorize";
import { createClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/app-header";
import { useSession } from "@/lib/use-session";

type ResourceContentType = "short_video" | "video" | "social_post" | "article" | "newsletter" | "other";

const CATEGORY_LABELS: Record<Category, string> = {
  fitness: "Fitness",
  programming: "Programming",
  ai: "AI & machine learning",
  career: "Career",
  cooking: "Food & cooking",
  travel: "Travel",
  finance: "Finance",
  study: "Study & education",
  design: "Design",
  productivity: "Productivity",
  health: "Health & wellness",
  entertainment: "Entertainment",
};
const PRODUCT_TAXONOMY = CATEGORIES.map((slug) => ({ slug, label: CATEGORY_LABELS[slug] }));

type Stage = "input" | "analyzing" | "confirmation" | "saved";

type Goal = { id: string; name: string };

type PreviewResponse = {
  candidate: {
    originalUrl: string;
    canonicalUrl: string;
    source: string;
    contentType: ResourceContentType;
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    estimatedMinutes: number;
  };
  suggestions: {
    categories: Array<{ slug: Category; confidence: number }>;
    goalMatches: Array<{ goalId: string; relevance: number }>;
    cognitiveEffort: number;
    actionability: number;
    timeSensitivity: number;
  };
  duplicate: { resourceId: string } | null;
  warnings: string[];
};

type ApiErrorBody = { error?: { code: string; message: string } };

const CONTENT_TYPES: ResourceContentType[] = ["short_video", "video", "social_post", "article", "newsletter", "other"];

export default function AddResourcePage() {
  const { loading: sessionLoading } = useSession();
  const [stage, setStage] = useState<Stage>("input");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [importSummary, setImportSummary] = useState("");
  const [importing, setImporting] = useState(false);

  // Editable confirmation-state fields.
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ResourceContentType>("article");
  const [estimatedMinutes, setEstimatedMinutes] = useState(5);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedGoalIds, setSelectedGoalIds] = useState<Set<string>>(new Set());
  const [savedGoalNames, setSavedGoalNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function ensureGoalsLoaded() {
    if (goals.length > 0) return goals;
    const supabase = createClient();
    const { data } = await supabase.from("goals").select("id, name").eq("active", true);
    const loaded = (data ?? []) as Goal[];
    setGoals(loaded);
    return loaded;
  }

  async function submitUrl() {
    if (!url.trim()) {
      setError("Paste a link first.");
      return;
    }

    setError("");
    setStage("analyzing");

    try {
      await ensureGoalsLoaded();

      const response = await fetch("/api/resources/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), userNote: note.trim() || undefined }),
      });

      const body = (await response.json()) as PreviewResponse & ApiErrorBody;

      if (!response.ok || body.error) {
        setError(body.error?.message ?? "We could not check that link.");
        setStage("input");
        return;
      }

      setPreview(body);
      setTitle(body.candidate.title ?? "");
      setContentType(body.candidate.contentType);
      setEstimatedMinutes(body.candidate.estimatedMinutes);
      setSelectedCategories(new Set(body.suggestions.categories.map((c) => c.slug)));
      setSelectedGoalIds(new Set(body.suggestions.goalMatches.map((m) => m.goalId)));
      setStage("confirmation");
    } catch {
      setError("We could not reach the server. Try again.");
      setStage("input");
    }
  }

  function toggleCategory(slug: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleGoal(id: string) {
    setSelectedGoalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmSave() {
    if (!preview) return;
    setSaving(true);
    setError("");

    const categories = PRODUCT_TAXONOMY
      .filter((category) => selectedCategories.has(category.slug))
      .map((category) => category.slug);

    const goalMatches = preview.suggestions.goalMatches
      .filter((match) => selectedGoalIds.has(match.goalId))
      .map((match) => ({ goalId: match.goalId, relevance: match.relevance }));
    for (const goalId of selectedGoalIds) {
      if (!goalMatches.some((m) => m.goalId === goalId)) {
        goalMatches.push({ goalId, relevance: 0.6 });
      }
    }

    try {
      const response = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: preview.candidate.originalUrl,
          userNote: note.trim() || undefined,
          title: title.trim() || undefined,
          description: preview.candidate.description,
          thumbnailUrl: preview.candidate.thumbnailUrl,
          contentType,
          estimatedMinutes,
          categories,
          goalMatches,
          cognitiveEffort: preview.suggestions.cognitiveEffort,
          actionability: preview.suggestions.actionability,
          timeSensitivity: preview.suggestions.timeSensitivity,
        }),
      });

      const body = (await response.json()) as { resourceId?: string } & ApiErrorBody;

      if (!response.ok || body.error) {
        setError(body.error?.message ?? "We could not save this resource.");
        setSaving(false);
        return;
      }

      setSavedGoalNames(goals.filter((goal) => selectedGoalIds.has(goal.id)).map((goal) => goal.name));
      setStage("saved");
    } catch {
      setError("We could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStage("input");
    setUrl("");
    setNote("");
    setError("");
    setPreview(null);
    setSavedGoalNames([]);
  }

  async function handleBookmarkFile(file: File) {
    setImporting(true);
    setImportSummary("");
    setError("");

    if (file.size > 10 * 1024 * 1024) {
      setError("That bookmark file is larger than the 10 MB limit.");
      setImporting(false);
      return;
    }

    try {
      const text = await file.text();
      const { entries, unsupportedCount } = parseBookmarkHtml(text);
      const batches: typeof entries[] = [];
      for (let i = 0; i < entries.length; i += 100) {
        batches.push(entries.slice(i, i + 100));
      }

      let imported = 0;
      let duplicates = 0;
      let failed = 0;

      for (const batch of batches) {
        const response = await fetch("/api/resources/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: batch }),
        });
        const body = (await response.json()) as {
          imported?: number;
          duplicates?: number;
          failed?: number;
        } & ApiErrorBody;

        if (!response.ok || body.error) {
          setError(body.error?.message ?? "The import could not be completed.");
          break;
        }

        imported += body.imported ?? 0;
        duplicates += body.duplicates ?? 0;
        failed += body.failed ?? 0;
      }

      setImportSummary(
        `Parsed ${entries.length} bookmark${entries.length === 1 ? "" : "s"} (${unsupportedCount} unsupported). Imported ${imported}, skipped ${duplicates} already saved, ${failed} failed.`,
      );
    } catch {
      setError("That file could not be read as a bookmark export.");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (sessionLoading) {
    return <main className="flex min-h-screen items-center justify-center">Loading…</main>;
  }

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <AppHeader current="add" />

        <section className="mt-10 rounded-[2rem] border border-[var(--border)] bg-white p-6 shadow-[0_20px_60px_rgba(40,65,46,0.08)] sm:p-10">
          {stage === "input" && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Save something</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight">Paste a link</h1>
              <input
                className="mt-6 min-h-12 w-full rounded-2xl border border-[var(--border)] px-4"
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                type="url"
                value={url}
              />
              <label className="mt-4 block text-sm font-medium text-[var(--muted)]">
                Why did you save this? (optional)
                <input
                  className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] px-4 font-normal text-[var(--foreground)]"
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. try this shoulder exercise"
                  value={note}
                />
              </label>

              {error && <p className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm leading-6 text-[#8a3a33]">{error}</p>}

              <button
                className="mt-6 min-h-12 w-full rounded-full bg-[var(--accent)] px-6 font-semibold text-white"
                onClick={submitUrl}
                type="button"
              >
                Continue
              </button>

              <div className="mt-8 border-t border-dashed border-[var(--border)] pt-6">
                <p className="text-sm font-medium">Or import your browser bookmarks</p>
                <p className="mt-1 text-sm text-[var(--muted)]">Export bookmarks as HTML from your browser, then upload the file.</p>
                <input
                  accept=".html,.htm"
                  className="mt-3 text-sm"
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleBookmarkFile(file);
                  }}
                  ref={fileInputRef}
                  type="file"
                />
                {importing && <p className="mt-2 text-sm text-[var(--muted)]">Importing…</p>}
                {importSummary && <p className="mt-2 text-sm leading-6">{importSummary}</p>}
              </div>
            </>
          )}

          {stage === "analyzing" && (
            <div className="py-16 text-center">
              <p className="text-lg font-semibold">Checking link → Reading details → Matching your goals</p>
              <p className="mt-3 text-sm text-[var(--muted)]">This usually takes a few seconds.</p>
            </div>
          )}

          {stage === "confirmation" && preview && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Confirm</p>
              <h1 className="mt-3 text-2xl font-semibold">Review before saving</h1>

              {preview.duplicate && (
                <p className="mt-4 rounded-xl bg-[#f2f4ee] px-4 py-3 text-sm leading-6">
                  You already saved this link. Saving again will update the existing resource.
                </p>
              )}

              {preview.warnings.length > 0 && (
                <ul className="mt-4 list-disc space-y-1 rounded-xl bg-[#f2f4ee] px-6 py-3 text-sm leading-6">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <label className="mt-6 block text-sm font-medium text-[var(--muted)]">
                Title
                <input
                  className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] px-4 font-normal text-[var(--foreground)]"
                  onChange={(e) => setTitle(e.target.value)}
                  value={title}
                />
              </label>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <label className="block text-sm font-medium text-[var(--muted)]">
                  Content type
                  <select
                    className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] px-4 font-normal text-[var(--foreground)]"
                    onChange={(e) => setContentType(e.target.value as ResourceContentType)}
                    value={contentType}
                  >
                    {CONTENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-[var(--muted)]">
                  Estimated minutes
                  <input
                    className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] px-4 font-normal text-[var(--foreground)]"
                    min={1}
                    max={240}
                    onChange={(e) => setEstimatedMinutes(Number(e.target.value) || 1)}
                    type="number"
                    value={estimatedMinutes}
                  />
                </label>
              </div>

              <fieldset className="mt-6">
                <legend className="text-sm font-medium text-[var(--muted)]">Categories</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PRODUCT_TAXONOMY.map((category) => (
                    <button
                      aria-pressed={selectedCategories.has(category.slug)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${selectedCategories.has(category.slug) ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`}
                      key={category.slug}
                      onClick={() => toggleCategory(category.slug)}
                      type="button"
                    >
                      {category.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {goals.length > 0 && (
                <fieldset className="mt-6">
                  <legend className="text-sm font-medium text-[var(--muted)]">Related goals</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {goals.map((goal) => (
                      <button
                        aria-pressed={selectedGoalIds.has(goal.id)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${selectedGoalIds.has(goal.id) ? "border-[var(--accent)] bg-[#e9f3e5] text-[var(--accent)]" : "border-[var(--border)]"}`}
                        key={goal.id}
                        onClick={() => toggleGoal(goal.id)}
                        type="button"
                      >
                        {goal.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              <label className="mt-6 block text-sm font-medium text-[var(--muted)]">
                Note
                <input
                  className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] px-4 font-normal text-[var(--foreground)]"
                  onChange={(e) => setNote(e.target.value)}
                  value={note}
                />
              </label>

              {error && <p className="mt-4 rounded-xl bg-[#fbeceb] px-4 py-3 text-sm leading-6 text-[#8a3a33]">{error}</p>}

              <div className="mt-8 flex gap-3">
                <button
                  className="min-h-12 flex-1 rounded-full border border-[var(--border)] px-6 font-semibold"
                  onClick={reset}
                  type="button"
                >
                  Start over
                </button>
                <button
                  className="min-h-12 flex-1 rounded-full bg-[var(--accent)] px-6 font-semibold text-white disabled:opacity-60"
                  disabled={saving}
                  onClick={confirmSave}
                  type="button"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          )}

          {stage === "saved" && (
            <div className="py-10 text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">Saved</p>
              <h1 className="mt-3 text-2xl font-semibold">Saved to your backlog</h1>
              <p className="mt-3 text-[var(--muted)]">
                {savedGoalNames.length > 0 ? `Matched to: ${savedGoalNames.join(", ")}` : "You can add goals to it anytime."}
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <button
                  className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold"
                  onClick={reset}
                  type="button"
                >
                  Add another
                </button>
                <Link className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 font-semibold text-white" href="/dashboard">
                  View backlog
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
