# Resurface.AI

The right save at the right time, resurfacing it.

Resurface.AI turns forgotten bookmarks into focused revisit sessions built around a user's goals and available time.

## The problem

People save constantly and return almost never. On the account this was built against,
the oldest unopened bookmark is from **October 2015**, and **53% of saves are more than a
year old**.

The saves are also scattered. Instagram holds one pile, YouTube another, the browser a
third, and each one is effectively write-only: content goes in, but there is no search, no
structure, and no way to get anything back out. These platforms are very good at capturing
what someone cares about and useless at helping them act on it.

The reason the backlog never clears is not that people lack motivation. It is that
"read it later" asks the wrong question. Standing at a bus stop with four minutes, nobody
wants a list of 92 things — they want the one thing worth doing in four minutes.

## What we built

**Ingestion from three platforms into one normalized store.** Saved content is the most
locked-down category on every major platform, and each one needed a different approach:

| Source | How it works |
| --- | --- |
| YouTube | OAuth with PKCE and `youtube.readonly`. Imports playlist videos with real durations. Playlist names become topic labels. |
| Chrome | A Manifest V3 extension paired to an account by a short-lived code. Sends bookmark folders and open tabs; folder paths become topic labels. |
| Instagram | Parses the user's own data export. No password is ever requested and the Saved page is never scraped. |

Three transports, one schema. Everything downstream reads the `resources` table and never
touches a platform API.

**An optimizer, not a list.** The differentiator is deliberately not aggregation. Given a
time budget and an energy mode, each eligible save is scored on goal relevance (0.35),
actionability (0.20), urgency (0.15), how long it has waited (0.15), and how well it fits
the current context (0.15). The queue is then filled against the remaining minutes so the
session ends when the time does. Every recommendation carries the reason it was chosen.

**Deterministic first, AI optional.** Categorization, duration estimation, and scoring are
all rule-based and unit-tested, so the product works with no API key and the same input
always produces the same queue.

### Design decisions worth knowing

- **Playlists over likes.** A like is a reaction; a video deliberately filed into a named
  playlist is an intention to return. The playlist name is also a topic label the user
  wrote themselves, which beats anything inferable from a title.
- **Watch Later is absent by necessity.** Third-party read access was removed in 2016. The
  API returns `200 OK` with zero items, so an implementation that assumed otherwise would
  look like it worked and silently import nothing.
- **Instagram is an import, not a connection.** It holds no credentials, so it has no row
  in `connections` at all. The same JSON schema is what Meta's Export Your Information
  program delivers to approved partners, so the parser is already the production one.
- **Tokens never reach the browser.** OAuth refresh tokens are encrypted with AES-256-GCM
  before storage, and the UI reads a view that excludes the token columns entirely.
- **Enrichment fetches user-supplied URLs**, so it validates every hostname and resolved
  IP and re-checks each redirect hop — a plain fetch would turn the server into a proxy
  into private networks and cloud metadata endpoints.

## Local development

Requirements: Node.js 20+ and pnpm. If `pnpm` is not installed yet:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
```

Then install and configure the app:

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Add the Supabase project URL and publishable key to `.env.local`, then open
`http://localhost:3000`.

## Supabase setup

Before creating an account, install the database schema once:

1. Open the project's Supabase SQL Editor.
2. Paste and run every file in `supabase/migrations/` in timestamp order. Run only
   migrations that have not already been applied to the project.
3. Under Authentication settings, decide whether email confirmation should be
   required. Turning it off is fastest for a local hackathon demo.

The migration creates the profiles, goals, resources, sessions, and interaction
tables, enables row-level security, and exposes the authenticated onboarding RPC.
Never put a Supabase service-role key in `.env.local` or browser code.

Useful checks:

```bash
pnpm lint
pnpm test
pnpm build
```

## Local maintenance

Set `CRON_SECRET` to a long random value, then process pending metadata without a hosted scheduler:

```bash
curl -X POST http://localhost:3000/api/maintenance/enrichment \
  -H "Authorization: Bearer $CRON_SECRET"
```

Production scheduling is defined in `.github/workflows/maintenance.yml`. Add
`PRODUCTION_APP_URL` and `CRON_SECRET` as GitHub Actions repository secrets. Scheduled
reminder email uses Resend; set `RESEND_API_KEY` and `REMINDER_FROM_EMAIL` in Vercel,
then the reminder job will deliver at most one email per user per local calendar day
when they have active resources.

Production jobs:

- `/api/maintenance/enrichment` runs hourly to enrich pending resources.
- `/api/maintenance/reminders` runs four times per hour to respect each user's saved
  reminder time and IANA timezone.

Both endpoints accept authenticated `GET` (for the production scheduler) and `POST`
(for manual operations). GitHub Actions is used because Vercel Hobby only supports
once-daily cron jobs, which cannot reliably respect per-user reminder times.

## Production deployment

1. Import this GitHub repository into Vercel.
2. Add every variable from `.env.example` for Production, Preview, and Development.
   Use a production `APP_URL` with no trailing slash and generate independent random
   values for `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET`.
3. Deploy and register this exact Google redirect URI:
   `https://<production-domain>/api/connect/youtube/callback`.
4. Add the production origin to Supabase Authentication URL Configuration as the Site
   URL and an allowed redirect URL.
5. Replace the wildcard Vercel host permission in `extension/manifest.json` with the
   exact production origin before publishing the extension. The pairing form remains
   editable so localhost can still be used during development.
6. Run `pnpm extension:package` and test pairing plus bookmark import against the
   production deployment.
7. Add the deployed origin as the GitHub Actions secret `PRODUCTION_APP_URL`, and add
   the exact same `CRON_SECRET` value used in Vercel. Run the **Production maintenance**
   workflow manually once to verify both endpoints.

## Architecture

```
YouTube OAuth ───┐
Chrome extension ┼──→ normalize + categorize ──→ resources ──→ optimizer ──→ session queue
Instagram import ┘
```

Next.js 16 (App Router) and React 19 on Supabase Postgres, with row-level security on every
table. Server-only concerns — OAuth, token encryption, extension pairing, imports — live in
route handlers; the browser never sees a service key or a platform token.

| Area | Where |
| --- | --- |
| Ingestion and normalization | `src/lib/ingest.ts`, `src/lib/canonical.ts`, `src/lib/categorize.ts` |
| Platform connectors | `src/lib/connectors/` |
| Scoring and queue assembly | `src/features/recommendations/` |
| Browser extension | `extension/` |
| Schema | `supabase/migrations/` |

## Documentation

- [Complete product flow](docs/PRODUCT_FLOW.md)
- [Web MVP scope](docs/MVP_SCOPE.md)
- [Onboarding UX recommendations](docs/ONBOARDING_UX.md)
- [Resource ingestion and categorization specification](docs/INGESTION_AND_CATEGORIZATION.md)
- [Recommender system specification](docs/RECOMMENDER_SYSTEM.md)
- [Local demo checklist](docs/DEMO_CHECKLIST.md)
