# Resurface.AI

The right save at the right time

Resurface.AI turns forgotten bookmarks into focused revisit sessions built around a user's goals and available time.

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

The same protected endpoint can be attached to a scheduler after deployment. Daily reminder preferences are stored in `profiles`; the web MVP displays the prompt in-app and does not require an email provider.

## Documentation

- [Complete product flow](docs/PRODUCT_FLOW.md)
- [Web MVP scope](docs/MVP_SCOPE.md)
- [Onboarding UX recommendations](docs/ONBOARDING_UX.md)
- [Resource ingestion and categorization specification](docs/INGESTION_AND_CATEGORIZATION.md)
- [Recommender system specification](docs/RECOMMENDER_SYSTEM.md)
- [Local demo checklist](docs/DEMO_CHECKLIST.md)
