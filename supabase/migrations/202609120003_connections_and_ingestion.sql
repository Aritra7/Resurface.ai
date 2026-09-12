-- Ingestion layer: platform connections, extension pairing, and sync observability.
-- Additive only. No existing column, index, or policy from migration 1 is altered.

-- 1. Platform provenance on the existing resources table.
alter table public.resources
  add column if not exists external_id   text,
  add column if not exists author        text,
  add column if not exists thumbnail_url text,
  add column if not exists collection    text,
  add column if not exists connection_id uuid;

comment on column public.resources.external_id is
  'Platform-native id: YouTube video id, Chrome bookmark node id, Instagram shortcode.';
comment on column public.resources.collection is
  'User-curated grouping: playlist name, bookmark folder path, Instagram collection name.';

-- Lets a sync re-run upsert the same platform item without duplicating it. Distinct from the
-- existing canonical_url unique index, which collapses the same URL across different sources.
create unique index if not exists resources_user_source_external_unique
  on public.resources (user_id, source, external_id)
  where external_id is not null;

-- 2. A grant to read one platform on the user's behalf.
-- Instagram is deliberately absent: it is a file import and we never hold credentials for it.
create table if not exists public.connections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  provider               text not null check (provider in ('youtube', 'browser_bookmark')),
  external_account_id    text,
  external_account_label text,
  access_token_enc       text,
  refresh_token_enc      text,
  expires_at             timestamptz,
  scopes                 text[],
  status                 text not null default 'active'
                           check (status in ('active', 'expired', 'revoked', 'error')),
  last_error             text,
  last_sync_at           timestamptz,
  items_count            integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'resources_connection_fk'
  ) then
    alter table public.resources
      add constraint resources_connection_fk
      foreign key (connection_id) references public.connections(id) on delete set null;
  end if;
end;
$$;

-- 3. Extension pairing. Short-lived codes bind an install to an account.
create table if not exists public.pairing_codes (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Long-lived opaque bearer tokens. Only the SHA-256 hash is ever stored.
create table if not exists public.extension_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_hash   text not null unique,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- 4. Sync observability. Cheap now, invaluable when a sync silently returns nothing.
create table if not exists public.sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid references public.connections(id) on delete cascade,
  provider       text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  items_seen     integer not null default 0,
  items_upserted integer not null default 0,
  status         text not null default 'running'
                   check (status in ('running', 'success', 'error')),
  error          text
);

create index if not exists sync_runs_user_started_idx
  on public.sync_runs (user_id, started_at desc);

-- 5. Row level security.
alter table public.connections      enable row level security;
alter table public.pairing_codes    enable row level security;
alter table public.extension_tokens enable row level security;
alter table public.sync_runs        enable row level security;

-- connections is SELECT-only for the owner, never insert/update/delete from a browser.
-- Writes happen exclusively in route handlers using the secret key, because this table
-- holds encrypted OAuth refresh tokens.
drop policy if exists "connections read own" on public.connections;
create policy "connections read own" on public.connections
  for select using (auth.uid() = user_id);

drop policy if exists "sync runs read own" on public.sync_runs;
create policy "sync runs read own" on public.sync_runs
  for select using (auth.uid() = user_id);

-- pairing_codes and extension_tokens intentionally have NO policies.
-- RLS enabled with no policy denies all client access; only the secret key reaches them.

-- 6. The view the UI reads. Excludes every token column so ciphertext never reaches a browser.
create or replace view public.connection_status
  with (security_invoker = true) as
  select id, user_id, provider, external_account_label, status,
         last_sync_at, items_count, last_error, created_at
  from public.connections;

grant select on public.connection_status to authenticated;
