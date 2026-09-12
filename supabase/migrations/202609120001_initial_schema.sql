create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  default_session_minutes integer not null default 10 check (default_session_minutes in (5, 10, 20)),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  weight numeric(4, 3) not null default 0.650 check (weight between 0 and 1),
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index goals_user_name_unique on public.goals (user_id, lower(name));
create unique index goals_one_primary_per_user on public.goals (user_id) where is_primary;

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  canonical_url text,
  source text not null default 'web',
  content_type text not null default 'article',
  title text,
  description text,
  summary text,
  user_note text,
  estimated_minutes integer not null default 5 check (estimated_minutes > 0),
  cognitive_effort numeric(4, 3) check (cognitive_effort between 0 and 1),
  actionability numeric(4, 3) check (actionability between 0 and 1),
  time_sensitivity numeric(4, 3) check (time_sensitivity between 0 and 1),
  enrichment_status text not null default 'pending' check (enrichment_status in ('pending', 'complete', 'failed')),
  status text not null default 'unreviewed' check (status in ('unreviewed', 'active', 'snoozed', 'completed', 'archived', 'unavailable')),
  saved_at timestamptz not null default now(),
  last_shown_at timestamptz,
  snoozed_until timestamptz,
  completed_at timestamptz
);

create unique index resources_user_canonical_url_unique
  on public.resources (user_id, canonical_url)
  where canonical_url is not null;

create table public.resource_goals (
  resource_id uuid not null references public.resources(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  relevance numeric(4, 3) not null default 0.5 check (relevance between 0 and 1),
  primary key (resource_id, goal_id)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  time_budget_minutes integer not null check (time_budget_minutes > 0),
  energy_mode text not null default 'balanced' check (energy_mode in ('quick', 'balanced', 'focused', 'surprise')),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.session_items (
  session_id uuid not null references public.sessions(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  position integer not null check (position >= 0),
  score numeric not null,
  explanation text not null,
  outcome text check (outcome in ('completed', 'snoozed', 'archived', 'skipped')),
  time_spent_seconds integer check (time_spent_seconds >= 0),
  primary key (session_id, resource_id)
);

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'completed', 'useful', 'not_useful', 'snoozed', 'archived', 'created_action', 'replaced')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.resources enable row level security;
alter table public.resource_goals enable row level security;
alter table public.sessions enable row level security;
alter table public.session_items enable row level security;
alter table public.interactions enable row level security;

create policy "profiles own rows" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "goals own rows" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "resources own rows" on public.resources for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "resource goals through owned resource" on public.resource_goals for all
  using (
    exists (select 1 from public.resources r where r.id = resource_id and r.user_id = auth.uid())
    and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.resources r where r.id = resource_id and r.user_id = auth.uid())
    and exists (select 1 from public.goals g where g.id = goal_id and g.user_id = auth.uid())
  );
create policy "sessions own rows" on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "session items through owned session" on public.session_items for all
  using (
    exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
    and exists (select 1 from public.resources r where r.id = resource_id and r.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid())
    and exists (select 1 from public.resources r where r.id = resource_id and r.user_id = auth.uid())
  );
create policy "interactions own rows" on public.interactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.complete_onboarding(
  p_display_name text,
  p_default_session_minutes integer,
  p_goals jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  goal_count integer;
  primary_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if char_length(trim(p_display_name)) not between 1 and 60 then
    raise exception 'Display name must contain 1 to 60 characters';
  end if;

  if p_default_session_minutes not in (5, 10, 20) then
    raise exception 'Invalid default session duration';
  end if;

  if jsonb_typeof(p_goals) <> 'array' then
    raise exception 'Goals must be an array';
  end if;

  goal_count := jsonb_array_length(p_goals);
  select count(*) into primary_count
  from jsonb_array_elements(p_goals) goal
  where coalesce((goal->>'is_primary')::boolean, false);

  if goal_count not between 1 and 3 or primary_count <> 1 then
    raise exception 'Choose one to three goals and exactly one main focus';
  end if;

  insert into public.profiles (id, display_name, default_session_minutes, onboarding_completed, updated_at)
  values (current_user_id, trim(p_display_name), p_default_session_minutes, true, now())
  on conflict (id) do update set
    display_name = excluded.display_name,
    default_session_minutes = excluded.default_session_minutes,
    onboarding_completed = true,
    updated_at = now();

  delete from public.goals where user_id = current_user_id;

  insert into public.goals (user_id, name, weight, is_primary)
  select
    current_user_id,
    trim(goal->>'name'),
    case when (goal->>'is_primary')::boolean then 1.0 else 0.65 end,
    (goal->>'is_primary')::boolean
  from jsonb_array_elements(p_goals) goal;
end;
$$;

revoke all on function public.complete_onboarding(text, integer, jsonb) from public;
grant execute on function public.complete_onboarding(text, integer, jsonb) to authenticated;
