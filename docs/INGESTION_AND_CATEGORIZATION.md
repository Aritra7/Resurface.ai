# Resource Ingestion and Categorization

This is the implementation specification for importing saved content from multiple
sources and turning it into normalized `resources` that the Resurface optimizer can
use. It is written for both human contributors and coding agents.

For the hackathon, optimize for a reliable vertical slice instead of the maximum
number of integrations. A user must always be able to save a valid public URL even
when metadata extraction or AI categorization fails.

## 1. Ownership and boundaries

This workstream owns:

- accepting URLs or imported bookmark records;
- identifying the source and content type;
- URL validation, canonicalization, and duplicate detection;
- retrieving metadata through permitted APIs or public page metadata;
- estimating consumption time and effort;
- suggesting categories and matching the user's existing goals;
- presenting an editable confirmation screen;
- writing `resources` and `resource_goals` records;
- retry and failure states for enrichment.

This workstream does **not** own:

- onboarding or authentication;
- queue scoring and session optimization;
- notification scheduling;
- scraping a user's private Instagram Saved collection;
- downloading or redistributing copyrighted media;
- a native mobile share extension in the current web MVP.

The database schema is installed by
`supabase/migrations/202609120001_initial_schema.sql`. Read it before changing the
ingestion code. Do not create a second competing resource model.

## 2. The core invariant

Every capture method must produce the same normalized candidate before it writes to
the database:

```text
Source input
  -> adapter-specific extraction
  -> normalized candidate
  -> validation and canonicalization
  -> enrichment
  -> categorization and goal matching
  -> user confirmation
  -> database transaction
```

A source adapter may collect different raw information, but downstream code must not
need to know whether the item came from Instagram, YouTube, Gmail, a browser import,
or manual paste.

## 3. Vocabulary

- **Source**: the platform that hosts or supplied the item, such as `instagram`,
  `youtube`, `gmail`, or `web`.
- **Content type**: the consumption format, such as `short_video`, `video`,
  `article`, `newsletter`, or `other`.
- **Resource**: one item the user may revisit and make a decision about.
- **Category**: what the content is about, for example `fitness` or `programming`.
- **Goal**: why that category matters to this user, for example “Improve fitness.”
- **Canonical URL**: a stable URL used for duplicate detection after tracking
  parameters and harmless URL variations have been removed.
- **Enrichment**: metadata retrieval, summarization, duration estimation, and
  categorization after the URL has been accepted.

Category and goal must remain separate. “OAuth” may be a category/topic while
“Grow my software engineering skills” is a user goal.

## 4. MVP source priority

Implement sources in this order:

1. Manual URL paste for Instagram, YouTube, and ordinary web pages.
2. Browser bookmark HTML import using the same normalization pipeline.
3. Browser extension or bookmarklet that posts the current page to the same API.
4. Gmail/newsletter import after the URL vertical slice is stable.

Do not build separate save logic for each UI. The paste form, bookmark importer, and
future extension should all call the same server-side ingestion service.

## 5. Source behavior

### 5.1 Instagram posts and Reels

Instagram does not expose a normal consumer API for downloading a user's Saved
collection. The supported MVP flow is explicit sharing:

```text
Instagram -> Copy link -> paste into Resurface
```

Rules:

- Accept `instagram.com/p/...`, `instagram.com/reel/...`, and supported share URLs.
- Strip tracking query parameters when building `canonical_url`.
- Store the permalink and open it in Instagram when revisiting.
- Use permitted public metadata or an approved embed when available.
- If metadata is unavailable, show a fallback title such as “Instagram Reel” and
  ask the user to choose a category or add a note.
- Never request an Instagram password.
- Never scrape a private Saved page or use an unofficial downloader.
- A private, restricted, deleted, or login-gated post can still be stored as a link.

For the MVP, infer `content_type = short_video` for `/reel/` and
`content_type = social_post` for `/p/`. Default an Instagram Reel to one minute when
duration is unknown, but label the duration as estimated in the review UI.

### 5.2 YouTube videos and Shorts

Accept regular, mobile, shortened, embed, and Shorts URLs:

- `youtube.com/watch?v=VIDEO_ID`
- `youtu.be/VIDEO_ID`
- `youtube.com/shorts/VIDEO_ID`
- `youtube.com/embed/VIDEO_ID`

Normalize all forms to one canonical representation such as
`https://www.youtube.com/watch?v=VIDEO_ID`. Preserve playlist context only if the
product intentionally imports a playlist; otherwise remove unrelated query fields.

Preferred metadata order:

1. YouTube Data API when configured and quota is available.
2. YouTube oEmbed for public title, author, and thumbnail.
3. Public page Open Graph metadata.
4. Link-only fallback.

Store the actual video duration when available. Convert it to whole estimated
minutes with a minimum of one. Classify Shorts as `short_video`, otherwise `video`.

### 5.3 Ordinary web links and Google results

The desired resource is the destination page, not a Google search-results page.
When the submitted URL is a known redirect wrapper, unwrap only a clearly encoded
HTTP(S) destination. Do not crawl arbitrary redirect chains without SSRF checks.

Preferred metadata order:

1. `<link rel="canonical">`
2. Open Graph title, description, image, and type
3. standard `<title>` and meta description
4. readable text extraction when safe and permitted
5. URL hostname fallback

Estimate article reading time from extracted words using a documented fixed rate,
initially 220 words per minute, rounded up with a minimum of one minute.

### 5.4 Browser bookmark import

Chrome and other browsers can export bookmarks as a Netscape Bookmark HTML file.
Parse that file locally in the browser when possible. Extract URL, bookmark title,
folder path, and saved timestamp. Send normalized bookmark candidates to the server
in small batches rather than uploading an entire raw browsing history.

Import review should show:

- total parsed;
- unsupported or invalid links;
- exact duplicates already present;
- new resources ready to import;
- optional folder-to-category suggestions.

The folder name is a weak categorization hint, not unquestioned truth.

### 5.5 Gmail newsletters

Gmail is a follow-on integration, not required for the first vertical slice.

Preferred permission model:

- user explicitly labels messages `Resurface`;
- request the narrowest Gmail scopes possible;
- import only labeled messages;
- keep refresh tokens encrypted and server-side;
- store provider IDs so the same message is not imported twice.

For the first newsletter implementation, one message should become one resource.
Later, the user may choose individual links from an issue. Do not silently create
twenty resources from one newsletter.

## 6. Normalized TypeScript contracts

Use one internal contract similar to the following. Names can be adjusted to the
project style, but the semantics should remain stable.

```ts
type ResourceSource =
  | "instagram"
  | "youtube"
  | "gmail"
  | "browser_bookmark"
  | "web";

type ResourceContentType =
  | "short_video"
  | "video"
  | "social_post"
  | "article"
  | "newsletter"
  | "other";

type IngestionInput = {
  url: string;
  userNote?: string;
  suppliedTitle?: string;
  sourceHint?: ResourceSource;
  categoryHints?: string[];
  importedAt?: string;
};

type NormalizedCandidate = {
  originalUrl: string;
  canonicalUrl: string;
  source: ResourceSource;
  contentType: ResourceContentType;
  externalId?: string;
  title?: string;
  description?: string;
  extractedText?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  estimatedMinutes: number;
  userNote?: string;
  savedAt: string;
  extractionWarnings: string[];
};

type CategorizationResult = {
  summary?: string;
  categories: Array<{
    slug: string;
    label: string;
    confidence: number;
  }>;
  goalMatches: Array<{
    goalId: string;
    relevance: number;
    reason: string;
  }>;
  cognitiveEffort: number;
  actionability: number;
  timeSensitivity: number;
  confidence: number;
};
```

All scores are normalized to `0..1`. Parse all external and AI-produced values with
Zod before they can reach the database.

## 7. URL validation and canonicalization

Canonicalization must be deterministic and covered by table-driven tests.

General rules:

1. Parse with the platform URL parser; do not use regex as the only validation.
2. Accept only `http:` and `https:`.
3. Lowercase the hostname and remove the fragment.
4. Remove default ports.
5. Remove known tracking parameters such as `utm_*`, `fbclid`, and `gclid`.
6. Preserve parameters that identify content, such as YouTube's `v`.
7. Apply source-specific transformations.
8. Do not follow a URL to a private or link-local address.

Block hosts and resolved IPs in loopback, private, link-local, and metadata ranges.
Recheck every redirect destination. Limit redirects, response bytes, content types,
and request duration. This is required because the server fetches user-controlled
URLs and would otherwise be vulnerable to SSRF.

Examples:

```text
https://youtu.be/abc123?si=tracking
  -> https://www.youtube.com/watch?v=abc123

https://www.instagram.com/reel/XYZ/?igsh=tracking
  -> https://www.instagram.com/reel/XYZ/

https://example.com/post?utm_source=newsletter#section
  -> https://example.com/post
```

## 8. Duplicate and idempotency rules

`resources` has a unique partial index on `(user_id, canonical_url)`. Always set
`canonical_url` for a valid URL so that index can do its job.

Expected behavior:

- same user + same canonical URL: return the existing resource;
- different users + same URL: create separate user-owned resources;
- failed request retried with the same URL: do not create a second row;
- shortened and long YouTube URLs for the same ID: one resource;
- similar content with different URLs: keep both, allowing the optimizer to apply a
  later redundancy penalty.

Do not merge based only on a similar title. Exact duplicate handling should be
automatic; semantic similarity is advisory.

Use an upsert or a transaction-safe insert that handles the unique-index race. A
client-side “check then insert” is insufficient because concurrent requests can both
pass the check.

## 9. Enrichment state machine

The existing `resources.enrichment_status` values are:

```text
pending -> complete
pending -> failed
failed  -> pending   (explicit retry)
```

Saving the base row should happen before expensive enrichment so the user's link is
not lost. Recommended flow:

1. Authenticate the user.
2. Validate and canonicalize the URL.
3. Insert or locate a `pending` resource.
4. Retrieve metadata with strict limits.
5. Categorize and match goals.
6. Update the resource and `resource_goals` in one transaction.
7. Mark `complete`, or mark `failed` while preserving the link.

For the hackathon, synchronous enrichment is acceptable if it normally finishes
within a few seconds. Keep the service boundary suitable for moving steps 4–6 into a
background job later.

Never show a raw provider or model error to the user. Store a structured internal
error and show an actionable fallback such as “We saved the link, but could not read
its details. Add a title or category.”

## 10. Categorization design

### 10.1 Inputs

Use only the information legitimately available:

- title and description;
- source and content type;
- readable extracted text, capped to a safe length;
- user's note;
- bookmark folder hint;
- the user's active goal names and IDs.

Never send access tokens, cookies, private email headers, or full unrelated inbox
content to an AI provider.

### 10.2 Deterministic first pass

Apply cheap deterministic rules before an AI call:

- source/content type from the URL pattern;
- duration from source metadata;
- reading time from word count;
- obvious keyword/category mappings;
- default effort by format;
- goal candidates from exact or strong keyword overlap.

This makes the system demoable even without an AI key and reduces latency.

### 10.3 AI-assisted pass

If AI classification is enabled, request structured JSON matching a Zod schema.
Constrain categories to a small product taxonomy plus at most one proposed new
category. Provide goal IDs and names, and require the model to return IDs rather than
inventing goals.

The model should predict:

- a one- or two-sentence summary;
- up to three categories;
- relevance to each plausible user goal;
- cognitive effort;
- actionability;
- time sensitivity;
- an overall classification confidence.

The model should **not** calculate the final optimizer score. Categorization supplies
signals; the optimizer remains deterministic and independently testable.

### 10.4 Confidence and confirmation

- `confidence >= 0.75`: preselect suggestions but keep them editable.
- `0.45 <= confidence < 0.75`: show suggestions with “Please confirm.”
- `confidence < 0.45`: require one user-selected category or goal before activation.

User corrections override automation. Record correction events later so the system
can learn, but do not block the MVP on adaptive learning.

## 11. Database mapping

Map the normalized result to the current schema as follows:

| Candidate field | Database target |
| --- | --- |
| original URL | `resources.url` |
| canonical URL | `resources.canonical_url` |
| source | `resources.source` |
| content type | `resources.content_type` |
| title | `resources.title` |
| description | `resources.description` |
| summary | `resources.summary` |
| user note | `resources.user_note` |
| estimated minutes | `resources.estimated_minutes` |
| effort | `resources.cognitive_effort` |
| actionability | `resources.actionability` |
| time sensitivity | `resources.time_sensitivity` |
| publication date | `resources.published_at` |
| relevance deadline | `resources.relevant_until` |
| time-sensitivity evidence | `resources.time_sensitivity_reason` |
| time-sensitivity confidence | `resources.time_sensitivity_confidence` |
| goal relevance | `resource_goals.relevance` |
| processing state | `resources.enrichment_status` |

One row in `resource_goals` is created for every confirmed goal association. The
`goal_id` must belong to the authenticated user; row-level security enforces this.

The recommender time-context fields are added by
`supabase/migrations/202609120002_recommender_time_context.sql`. The schema does not
yet persist category labels, thumbnails, provider IDs, raw extraction errors, or
whether duration is estimated. Before implementing those features, add one reviewed
follow-up migration rather than overloading unrelated columns. Suggested additions
are:

```text
resources.categories text[] not null default '{}'
resources.thumbnail_url text
resources.external_id text
resources.duration_seconds integer
resources.duration_is_estimated boolean not null default true
resources.enrichment_error_code text
```

Do not edit an already-applied migration. Add a new timestamped migration.

## 12. API shape

Recommended routes for the web MVP:

```text
POST /api/resources/preview
  validates, canonicalizes, fetches metadata, and returns an editable preview

POST /api/resources
  accepts the confirmed preview and creates or returns the resource

POST /api/resources/import
  accepts a bounded batch of normalized bookmark inputs

POST /api/resources/:id/retry-enrichment
  retries a failed enrichment
```

The server must derive `user_id` from the authenticated Supabase session. Never
accept `user_id` from the request body.

Suggested preview response:

```json
{
  "candidate": {
    "canonicalUrl": "https://www.youtube.com/watch?v=abc123",
    "source": "youtube",
    "contentType": "video",
    "title": "OAuth explained visually",
    "estimatedMinutes": 6
  },
  "suggestions": {
    "categories": ["programming", "authentication"],
    "goalMatches": [
      { "goalId": "uuid-from-database", "relevance": 0.91 }
    ]
  },
  "duplicate": null,
  "warnings": []
}
```

Use stable error codes in addition to readable messages:

```text
INVALID_URL
UNSUPPORTED_PROTOCOL
BLOCKED_DESTINATION
METADATA_UNAVAILABLE
FETCH_TIMEOUT
FETCH_TOO_LARGE
DUPLICATE_RESOURCE
AI_OUTPUT_INVALID
UNAUTHENTICATED
```

## 13. Suggested code organization

Keep platform differences behind adapters:

```text
src/
  app/
    add/page.tsx
    api/resources/preview/route.ts
    api/resources/route.ts
  features/resources/
    schemas.ts
    types.ts
    canonicalize-url.ts
    ingest-resource.ts
    categorize-resource.ts
    estimate-duration.ts
    repositories.ts
    adapters/
      instagram.ts
      youtube.ts
      web.ts
      bookmark-import.ts
```

The exact folders may vary, but dependencies should point inward:

```text
route/UI -> ingestion service -> adapters + categorizer -> repository/Supabase
```

Adapters do not write directly to Supabase. UI components do not fetch arbitrary
third-party pages. The central service owns validation, idempotency, and state
transitions.

## 14. UI flow for `/add`

### State 1: input

```text
Paste a link
[ https://...                              ] [Continue]
```

Optional note: “Why did you save this?”

### State 2: analyzing

Show visible stages without pretending certainty:

```text
Checking link -> Reading details -> Matching your goals
```

### State 3: confirmation

The user can edit:

- title;
- content type;
- estimated time;
- categories;
- related goals;
- note.

Clearly mark estimates. Do not require correction when suggestions look right.

### State 4: saved

Show where the resource went and the next useful action:

```text
Saved to your backlog
Matched to: Improve fitness
[Add another] [View backlog]
```

If metadata failed, still show success for the saved link and request the minimum
missing information separately.

## 15. Testing requirements

At minimum, add unit tests for:

- protocol rejection;
- tracking-parameter removal;
- canonicalization for every supported YouTube URL form;
- Instagram Reel versus post detection;
- duplicate canonical URLs;
- reading-time calculation;
- score clamping to `0..1`;
- invalid AI JSON;
- low-confidence fallback behavior.

Add integration tests for:

- authenticated user creates a resource and goal mappings;
- unauthenticated request is rejected;
- one user cannot associate another user's goal;
- metadata failure still leaves a retrievable resource;
- retry does not duplicate the resource;
- concurrent insert attempts return one logical resource.

Manual demo fixtures should include:

1. an Instagram fitness Reel with no retrievable metadata;
2. a one-minute YouTube Short;
3. a six-minute technical YouTube video;
4. a long technical article;
5. a URL already saved with tracking parameters;
6. an unreachable but syntactically valid public URL.

Tests must not depend on live Instagram, YouTube, Gmail, or AI services. Put provider
calls behind interfaces and test with fixtures/mocks.

## 16. Definition of done

This workstream is complete for the hackathon when:

- an authenticated user can paste Instagram, YouTube, and web URLs;
- valid links are never lost because enrichment failed;
- source and content type are identified consistently;
- equivalent URLs do not produce duplicates;
- the review screen makes every automated field editable;
- confirmed resources and goal relevance are stored in the existing Supabase model;
- `/dashboard` can list the newly saved resources;
- the optimizer receives reliable time, effort, actionability, urgency, and goal
  relevance signals;
- errors are understandable and safe;
- core logic has deterministic tests;
- lint, tests, and the production build pass.

## 17. Recommended implementation sequence

Do not implement every provider simultaneously.

1. Add shared Zod schemas and TypeScript types.
2. Implement and test URL validation/canonicalization.
3. Implement the base resource repository and idempotent insert.
4. Build the `/add` paste and confirmation flow with link-only fallback.
5. Add YouTube enrichment.
6. Add Instagram identification and fallback metadata.
7. Add ordinary web metadata extraction with SSRF protection.
8. Add deterministic categorization and user-goal matching.
9. Add optional AI-assisted classification behind an interface.
10. Add bookmark HTML batch import.
11. Integrate the dashboard backlog.
12. Only then consider Gmail.

At the end of every step, run:

```bash
pnpm lint
pnpm test
pnpm build
```

## 18. Handoff prompt for a coding agent

When asking Claude or another coding agent to work on this feature, provide a narrow
task rather than “build ingestion.” A suitable first prompt is:

```text
Read AGENTS.md, docs/PRODUCT_FLOW.md,
docs/INGESTION_AND_CATEGORIZATION.md, and the Supabase migrations completely.
Implement only steps 1 and 2 from the recommended ingestion sequence: shared Zod
contracts plus deterministic URL validation/canonicalization for Instagram,
YouTube, and ordinary HTTP(S) web URLs. Include table-driven Vitest tests. Do not
fetch third-party pages, add AI calls, change authentication, or write database
records yet. Preserve existing work and run lint, tests, and the production build.
```

Continue with similarly bounded prompts and require tests at each boundary. This
keeps source-specific logic from becoming one large, difficult-to-debug route.
