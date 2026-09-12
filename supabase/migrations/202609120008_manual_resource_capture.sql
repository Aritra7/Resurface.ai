-- Manual capture metadata and an atomic, RLS-respecting save operation.
-- This follows the connector migrations already applied as 004-007; it does not
-- recreate their tables, indexes, token handling, or ingestion pipeline.

alter table public.resources
  add column if not exists categories text[] not null default '{}';

comment on column public.resources.categories is
  'Confirmed topic slugs for display and filtering. Goal relevance remains in resource_goals.';

create or replace function public.save_manual_resource(
  p_url text,
  p_canonical_url text,
  p_source text,
  p_content_type text,
  p_title text,
  p_description text,
  p_user_note text,
  p_thumbnail_url text,
  p_estimated_minutes integer,
  p_external_id text,
  p_categories text[],
  p_cognitive_effort numeric,
  p_actionability numeric,
  p_time_sensitivity numeric,
  p_goal_matches jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  saved_resource_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_source not in ('instagram', 'youtube', 'gmail', 'browser_bookmark', 'web') then
    raise exception 'Invalid source';
  end if;
  if p_content_type not in ('short_video', 'video', 'social_post', 'article', 'newsletter', 'other') then
    raise exception 'Invalid content type';
  end if;
  if p_estimated_minutes not between 1 and 240 then
    raise exception 'Invalid estimated duration';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_categories, '{}')) category
    where category <> all(array[
      'fitness', 'programming', 'ai', 'career', 'cooking', 'travel', 'finance',
      'study', 'design', 'productivity', 'health', 'entertainment'
    ]::text[])
  ) then
    raise exception 'Invalid category';
  end if;
  if jsonb_typeof(coalesce(p_goal_matches, '[]'::jsonb)) <> 'array' then
    raise exception 'Goal matches must be an array';
  end if;

  insert into public.resources as resource (
    user_id, url, canonical_url, source, external_id, content_type, title,
    description, user_note, thumbnail_url, estimated_minutes, categories,
    cognitive_effort, actionability, time_sensitivity, enrichment_status, status
  ) values (
    current_user_id, p_url, p_canonical_url, p_source, p_external_id,
    p_content_type, nullif(trim(p_title), ''), p_description, p_user_note,
    p_thumbnail_url, p_estimated_minutes, coalesce(p_categories, '{}'),
    p_cognitive_effort, p_actionability, p_time_sensitivity, 'complete', 'active'
  )
  on conflict (user_id, canonical_url) where canonical_url is not null
  do update set
    url = excluded.url,
    source = excluded.source,
    external_id = coalesce(excluded.external_id, resource.external_id),
    content_type = excluded.content_type,
    title = coalesce(excluded.title, resource.title),
    description = coalesce(excluded.description, resource.description),
    user_note = excluded.user_note,
    thumbnail_url = coalesce(excluded.thumbnail_url, resource.thumbnail_url),
    estimated_minutes = excluded.estimated_minutes,
    categories = excluded.categories,
    cognitive_effort = excluded.cognitive_effort,
    actionability = excluded.actionability,
    time_sensitivity = excluded.time_sensitivity,
    enrichment_status = 'complete',
    status = 'active'
  returning resource.id into saved_resource_id;

  delete from public.resource_goals where resource_id = saved_resource_id;
  insert into public.resource_goals (resource_id, goal_id, relevance)
  select
    saved_resource_id,
    (goal_match->>'goalId')::uuid,
    greatest(0, least(1, (goal_match->>'relevance')::numeric))
  from jsonb_array_elements(coalesce(p_goal_matches, '[]'::jsonb)) goal_match
  where exists (
    select 1 from public.goals goal
    where goal.id = (goal_match->>'goalId')::uuid
      and goal.user_id = current_user_id
      and goal.active
  );

  return saved_resource_id;
end;
$$;

revoke all on function public.save_manual_resource(
  text, text, text, text, text, text, text, text, integer, text,
  text[], numeric, numeric, numeric, jsonb
) from public;
grant execute on function public.save_manual_resource(
  text, text, text, text, text, text, text, text, integer, text,
  text[], numeric, numeric, numeric, jsonb
) to authenticated;
