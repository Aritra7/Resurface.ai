# Resurface.AI

The right save at the right time, resurfacing it.

Resurface.AI turns forgotten bookmarks into focused revisit sessions built around a user's goals and available time.

## The problem

People save constantly and return almost never. Instagram holds one pile, YouTube another,
the browser a third — and each one is write-only. Things go in; there is no search, no
structure, and no practical way to get anything back out.

The backlog does not clear because "read it later" asks the wrong question. With ten
minutes free, nobody wants a list of ninety things. They want the one thing worth doing in
ten minutes.

## What we built

Resurface pulls your saves out of those silos and turns them into a session that fits the
time you actually have.

- **Three sources, one place.** YouTube playlists arrive with real durations, Chrome
  bookmarks with their folder names, and Instagram saves from your own data export — no
  password, no scraping.
- **An optimizer, not a list.** Tell it how long you have and it scores every save on your
  goals, how long it has waited, the focus it needs, and whether it fits the time. Ten
  minutes in, ten minutes out.
- **Every pick is explained.** Each recommendation shows why it was chosen, so the queue
  is something you can correct rather than just accept.

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
