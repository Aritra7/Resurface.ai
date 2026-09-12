@AGENTS.md

## Project context

Before implementing resource capture, bookmark imports, platform adapters, metadata
extraction, categorization, or goal matching, read these files completely:

- `docs/PRODUCT_FLOW.md`
- `docs/MVP_SCOPE.md`
- `docs/INGESTION_AND_CATEGORIZATION.md`
- every migration in `supabase/migrations/`

Treat `docs/INGESTION_AND_CATEGORIZATION.md` as the authoritative implementation
contract for the ingestion workstream. Keep provider-specific behavior behind
adapters, validate external and AI output with Zod, preserve a link when enrichment
fails, derive user identity from the authenticated session, and do not weaken row
level security.

Work in small vertical increments. Add deterministic tests before adding another
provider, and run `pnpm lint`, `pnpm test`, and `pnpm build` before handing work back.
