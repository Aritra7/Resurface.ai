-- Fix: ON CONFLICT (user_id, source, external_id) could never match.
--
-- The previous index was partial (`where external_id is not null`). Postgres only uses a
-- partial index for ON CONFLICT when the statement repeats its exact predicate, which
-- PostgREST cannot express, so every ingest upsert failed with SQLSTATE 42P10.
--
-- Replacing it with a total unique index. Rows with a null external_id are unaffected,
-- because in Postgres nulls are never equal to one another and so never collide.

drop index if exists public.resources_user_source_external_unique;

create unique index if not exists resources_user_source_external_unique
  on public.resources (user_id, source, external_id);
