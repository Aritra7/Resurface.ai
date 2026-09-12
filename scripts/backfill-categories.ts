/**
 * Backfills resources.categories for items imported before ingest persisted them.
 *
 * The resources library and learning-path pages filter on this column, so imports
 * without it are invisible to every category filter.
 *
 *   node --env-file=.env.local scripts/backfill-categories.ts
 */
import { categorize } from "../src/lib/categorize.ts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const headers = {
  apikey: SECRET,
  Authorization: `Bearer ${SECRET}`,
  "Content-Type": "application/json",
};

type Row = {
  id: string;
  url: string;
  source: string;
  content_type: string;
  title: string | null;
  description: string | null;
  collection: string | null;
  estimated_minutes: number;
  categories: string[] | null;
};

const rows: Row[] = await (
  await fetch(
    `${SUPABASE_URL}/rest/v1/resources?select=id,url,source,content_type,title,description,collection,estimated_minutes,categories`,
    { headers },
  )
).json();

let updated = 0;
const tally = new Map<string, number>();

for (const row of rows) {
  // Never overwrite categories a user confirmed or edited by hand.
  if (row.categories && row.categories.length > 0) continue;

  const { categories } = categorize({
    title: row.title,
    description: row.description,
    collection: row.collection,
    url: row.url,
    source: row.source,
    contentType: row.content_type,
    estimatedMinutes: row.estimated_minutes,
  });

  const slugs = categories.map((category) => category.slug);
  if (slugs.length === 0) continue;

  await fetch(`${SUPABASE_URL}/rest/v1/resources?id=eq.${row.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ categories: slugs }),
  });

  updated += 1;
  for (const slug of slugs) tally.set(slug, (tally.get(slug) ?? 0) + 1);
}

console.log(`Categorized ${updated} of ${rows.length} resources`);
for (const [slug, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${slug}: ${count}`);
}
