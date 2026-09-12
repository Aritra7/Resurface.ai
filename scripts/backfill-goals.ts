/**
 * Backfills resource_goals and scoring columns for resources imported before
 * categorization existed.
 *
 * goal_relevance carries 0.35 of the optimizer score, the largest single weight, so a
 * resource with no goal row scores zero on relevance no matter how well it matches.
 * New imports do this inline in ingest.ts; this repairs existing rows.
 *
 *   node --env-file=.env.local scripts/backfill-goals.ts
 */
import { categorize, matchGoals } from "../src/lib/categorize.ts";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const headers = {
  apikey: SECRET,
  Authorization: `Bearer ${SECRET}`,
  "Content-Type": "application/json",
};

type Resource = {
  id: string;
  user_id: string;
  url: string;
  source: string;
  content_type: string;
  title: string | null;
  description: string | null;
  collection: string | null;
  estimated_minutes: number;
};

async function main() {
  const resources: Resource[] = await (
    await fetch(
      `${SUPABASE_URL}/rest/v1/resources?select=id,user_id,url,source,content_type,title,description,collection,estimated_minutes`,
      { headers },
    )
  ).json();

  const goalsByUser = new Map<string, Array<{ id: string; name: string }>>();
  const links: Array<{ resource_id: string; goal_id: string; relevance: number }> = [];
  const updates: Array<Record<string, unknown>> = [];

  for (const resource of resources) {
    if (!goalsByUser.has(resource.user_id)) {
      const goals = await (
        await fetch(
          `${SUPABASE_URL}/rest/v1/goals?select=id,name&user_id=eq.${resource.user_id}&active=eq.true`,
          { headers },
        )
      ).json();
      goalsByUser.set(resource.user_id, goals);
    }

    const result = categorize({
      title: resource.title,
      description: resource.description,
      collection: resource.collection,
      url: resource.url,
      source: resource.source,
      contentType: resource.content_type,
      estimatedMinutes: resource.estimated_minutes,
    });

    updates.push({
      id: resource.id,
      actionability: result.actionability,
      cognitive_effort: result.cognitiveEffort,
      time_sensitivity: result.timeSensitivity,
      time_sensitivity_confidence: result.confidence,
    });

    for (const match of matchGoals(result.categories, goalsByUser.get(resource.user_id) ?? [])) {
      links.push({
        resource_id: resource.id,
        goal_id: match.goalId,
        relevance: match.relevance,
      });
    }
  }

  // Re-score with the real categorizer rather than the migration's neutral midpoints.
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100);
    await Promise.all(
      chunk.map((row) => {
        const { id, ...fields } = row;
        return fetch(`${SUPABASE_URL}/rest/v1/resources?id=eq.${id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(fields),
        });
      }),
    );
  }
  console.log(`Re-scored ${updates.length} resources`);

  for (let i = 0; i < links.length; i += 200) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/resource_goals?on_conflict=resource_id,goal_id`,
      {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(links.slice(i, i + 200)),
      },
    );
    if (!response.ok) console.error("  link error:", (await response.text()).slice(0, 200));
  }
  console.log(`Linked ${links.length} resource-goal pairs`);
}

main();
