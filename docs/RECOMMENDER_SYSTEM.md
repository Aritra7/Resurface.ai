# Recommender System

The Resurface recommender is a deterministic, explainable module. It accepts
normalized resources, user priorities, and current session context, then returns a
finite queue that stays within the user's time budget.

The implementation is under `src/features/recommendations/` and deliberately has no
Supabase or UI dependency. Ingestion can therefore evolve independently as long as
it supplies the documented input contract.

Database support for publication dates, relevance deadlines, evidence, and
confidence is installed by
`supabase/migrations/202609120002_recommender_time_context.sql`.

## Inputs

Each confirmed resource supplies:

- ID, title, source, and content type;
- estimated consumption minutes;
- cognitive effort, actionability, and base time sensitivity from `0..1`;
- save, publication, snooze, and optional relevance-deadline timestamps;
- confirmed goal matches and relevance values;
- lifecycle status.

The session context supplies:

- a positive whole-minute budget chosen by the user;
- energy mode: quick, balanced, focused, or surprise;
- the user's current primary goal IDs;
- an explicit current timestamp so runs and tests are reproducible.

## Eligibility

Only `active` resources are eligible. Resources are excluded if they are completed,
archived, unavailable, still unreviewed, currently snoozed, invalid, or longer than
the entire session budget.

An expired relevance deadline sets urgency to zero but does not automatically
archive the resource. Content may retain evergreen value after an event passes, so
that decision remains with the user.

## Score

```text
score =
    0.35 * goal relevance
  + 0.20 * actionability
  + 0.15 * dynamic urgency
  + 0.15 * age boost
  + 0.15 * context fit
```

Goal relevance receives a 15% boost for a match to the user's main goal, capped at
one. Missing actionability and effort use neutral defaults. Missing time sensitivity
uses a conservative default of `0.2`.

Age boost increases linearly until it reaches one after 90 days. It prevents old
resources from disappearing, while urgency remains a separate signal.

Context fit compares cognitive effort with the chosen energy mode. Time feasibility
is enforced before scoring rather than allowing an impossible item into the queue.

## Dynamic urgency

Base time sensitivity describes whether waiting generally reduces usefulness.
Effective urgency is recalculated for every session:

| Evidence | Minimum effective urgency |
| --- | ---: |
| Deadline within 14 days | 0.50 |
| Deadline within 7 days | 0.75 |
| Deadline within 2 days | 1.00 |
| Deadline passed | 0.00 |

Freshness boosts only apply when base sensitivity is already at least `0.5`. A new
evergreen tutorial therefore does not receive a news-like freshness boost merely
because it was published today.

Ingestion may use deterministic date extraction and AI assistance to propose the
base score, relevant-until timestamp, reason, and confidence. High urgency should be
user-confirmable. The recommender never calls an AI model.

## Queue construction

The MVP uses a deterministic greedy heuristic:

1. Filter ineligible resources.
2. Score every remaining resource.
3. Select the highest marginal-utility item that fits the remaining minutes.
4. Apply repeat penalties for source, content type, and goal overlap.
5. Prefer other formats after two items of the same content type when alternatives
   fit.
6. Break ties by the older save and then stable resource ID.
7. Stop when no remaining resource fits.

This is intentionally simple enough to explain during the hackathon. The selection
strategy can later be replaced by integer optimization without changing the public
types or scoring signals.

## Explanations

Reasons are generated from actual components, never by a language model. Examples:

- Supports your main goal
- Becomes less useful within two days
- Waiting for 45 days
- Fits your focused session
- Takes about 8 minutes

The function returns at most three concise reasons per resource.

## Integration contract

The ingestion workstream should map database rows into `RecommendationResource`.
The UI or a server service then calls:

```ts
const queue = buildSession(resources, {
  timeBudgetMinutes: 10,
  energyMode: "balanced",
  primaryGoalIds: [primaryGoalId],
  now: new Date().toISOString(),
});
```

After a session is persisted, the ordered output maps to `session_items.position`,
`session_items.score`, and `session_items.explanation`.

Do not duplicate scoring logic in SQL, React components, or ingestion adapters. This
module is the single source of truth.
