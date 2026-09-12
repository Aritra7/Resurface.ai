alter table public.resources
  add column categories text[] not null default '{}',
  add column thumbnail_url text,
  add column external_id text,
  add column duration_seconds integer check (duration_seconds >= 0),
  add column duration_is_estimated boolean not null default true,
  add column enrichment_error_code text;

comment on column public.resources.categories is
  'Product-taxonomy slugs describing what the content is about, e.g. fitness, programming. Distinct from goal_id relevance in resource_goals.';
comment on column public.resources.duration_is_estimated is
  'False only when duration_seconds came from authoritative source metadata (e.g. the YouTube Data API).';
comment on column public.resources.enrichment_error_code is
  'Stable internal error code from a failed enrichment attempt; never a raw provider/model error string.';

-- Idempotent, race-safe insert keyed on the existing partial unique index
-- (user_id, canonical_url) where canonical_url is not null. A single
-- INSERT ... ON CONFLICT statement is required instead of a client-side
-- check-then-insert because concurrent requests for the same URL can both
-- pass a prior existence check.
create or replace function public.upsert_resource(
  p_url text,
  p_canonical_url text,
  p_source text,
  p_content_type text,
  p_title text default null,
  p_description text default null,
  p_user_note text default null,
  p_estimated_minutes integer default 5,
  p_external_id text default null,
  p_thumbnail_url text default null,
  p_duration_seconds integer default null,
  p_duration_is_estimated boolean default true
) returns table (resource_id uuid, is_new boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_canonical_url is null or length(trim(p_canonical_url)) = 0 then
    raise exception 'canonical_url is required';
  end if;

  if p_source not in ('instagram', 'youtube', 'gmail', 'browser_bookmark', 'web') then
    raise exception 'Invalid source';
  end if;

  if p_content_type not in ('short_video', 'video', 'social_post', 'article', 'newsletter', 'other') then
    raise exception 'Invalid content type';
  end if;

  return query
  insert into public.resources as r (
    user_id, url, canonical_url, source, content_type, title, description,
    user_note, estimated_minutes, external_id, thumbnail_url, duration_seconds,
    duration_is_estimated, enrichment_status, status
  ) values (
    current_user_id, p_url, p_canonical_url, p_source, p_content_type, p_title,
    p_description, p_user_note, greatest(coalesce(p_estimated_minutes, 5), 1), p_external_id,
    p_thumbnail_url, p_duration_seconds, coalesce(p_duration_is_estimated, true),
    'pending', 'unreviewed'
  )
  on conflict (user_id, canonical_url) where canonical_url is not null
  do update set url = r.url
  returning r.id, (xmax = 0);
end;
$$;

-- Applies enrichment + categorization results and goal matches in one
-- transaction, or records a failure while preserving the already-saved link.
create or replace function public.finalize_resource_categorization(
  p_resource_id uuid,
  p_enrichment_status text,
  p_summary text default null,
  p_categories text[] default null,
  p_cognitive_effort numeric default null,
  p_actionability numeric default null,
  p_time_sensitivity numeric default null,
  p_goal_matches jsonb default '[]'::jsonb,
  p_enrichment_error_code text default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_enrichment_status not in ('complete', 'failed') then
    raise exception 'Invalid enrichment status';
  end if;

  if jsonb_typeof(coalesce(p_goal_matches, '[]'::jsonb)) <> 'array' then
    raise exception 'Goal matches must be an array';
  end if;

  update public.resources
  set summary = coalesce(p_summary, summary),
      categories = coalesce(p_categories, categories),
      cognitive_effort = coalesce(p_cognitive_effort, cognitive_effort),
      actionability = coalesce(p_actionability, actionability),
      time_sensitivity = coalesce(p_time_sensitivity, time_sensitivity),
      enrichment_status = p_enrichment_status,
      enrichment_error_code = p_enrichment_error_code,
      status = case when status = 'unreviewed' and p_enrichment_status = 'complete' then 'active' else status end
  where id = p_resource_id and user_id = current_user_id;

  if not found then
    raise exception 'Resource not found';
  end if;

  delete from public.resource_goals where resource_id = p_resource_id;

  insert into public.resource_goals (resource_id, goal_id, relevance)
  select
    p_resource_id,
    (match->>'goalId')::uuid,
    greatest(least(coalesce((match->>'relevance')::numeric, 0), 1), 0)
  from jsonb_array_elements(coalesce(p_goal_matches, '[]'::jsonb)) match
  where exists (
    select 1 from public.goals g where g.id = (match->>'goalId')::uuid and g.user_id = current_user_id
  );
end;
$$;

create or replace function public.retry_resource_enrichment(
  p_resource_id uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.resources
  set enrichment_status = 'pending', enrichment_error_code = null
  where id = p_resource_id and user_id = auth.uid() and enrichment_status = 'failed';

  if not found then
    raise exception 'Resource not found or not in a failed state';
  end if;
end;
$$;

revoke all on function public.upsert_resource(text, text, text, text, text, text, text, integer, text, text, integer, boolean) from public;
revoke all on function public.finalize_resource_categorization(uuid, text, text, text[], numeric, numeric, numeric, jsonb, text) from public;
revoke all on function public.retry_resource_enrichment(uuid) from public;

grant execute on function public.upsert_resource(text, text, text, text, text, text, text, integer, text, text, integer, boolean) to authenticated;
grant execute on function public.finalize_resource_categorization(uuid, text, text, text[], numeric, numeric, numeric, jsonb, text) to authenticated;
grant execute on function public.retry_resource_enrichment(uuid) to authenticated;
