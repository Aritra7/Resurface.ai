-- Local-MVP settings, reminder preferences, and atomic resource correction.

alter table public.profiles
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists reminder_time time not null default '18:00',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists last_reminder_at timestamptz;

create or replace function public.update_profile_settings(
  p_display_name text,
  p_default_session_minutes integer,
  p_reminder_enabled boolean,
  p_reminder_time time,
  p_timezone text,
  p_primary_goal_id uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 60 then raise exception 'Invalid display name'; end if;
  if p_default_session_minutes not in (5, 10, 20) then raise exception 'Invalid default session duration'; end if;
  if char_length(trim(p_timezone)) not between 1 and 80 then raise exception 'Invalid timezone'; end if;
  if not exists (select 1 from public.goals where id = p_primary_goal_id and user_id = current_user_id and active) then
    raise exception 'Primary goal is not active';
  end if;

  update public.profiles set
    display_name = trim(p_display_name),
    default_session_minutes = p_default_session_minutes,
    reminder_enabled = p_reminder_enabled,
    reminder_time = p_reminder_time,
    timezone = trim(p_timezone),
    updated_at = now()
  where id = current_user_id;

  update public.goals set is_primary = false, weight = least(weight, 0.65) where user_id = current_user_id;
  update public.goals set is_primary = true, weight = 1 where id = p_primary_goal_id and user_id = current_user_id;
end;
$$;

create or replace function public.update_resource_details(
  p_resource_id uuid,
  p_title text,
  p_user_note text,
  p_content_type text,
  p_estimated_minutes integer,
  p_categories text[],
  p_cognitive_effort numeric,
  p_actionability numeric,
  p_time_sensitivity numeric,
  p_status text,
  p_goal_matches jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.resources where id = p_resource_id and user_id = current_user_id) then raise exception 'Resource not found'; end if;
  if char_length(trim(p_title)) not between 1 and 500 then raise exception 'Invalid title'; end if;
  if p_content_type not in ('short_video', 'video', 'social_post', 'article', 'newsletter', 'other') then raise exception 'Invalid content type'; end if;
  if p_estimated_minutes not between 1 and 240 then raise exception 'Invalid estimated duration'; end if;
  if p_status not in ('active', 'completed', 'archived') then raise exception 'Invalid editable status'; end if;
  if exists (
    select 1 from unnest(coalesce(p_categories, '{}')) category
    where category <> all(array[
      'fitness', 'programming', 'ai', 'career', 'cooking', 'travel', 'finance',
      'study', 'design', 'productivity', 'health', 'entertainment'
    ]::text[])
  ) then raise exception 'Invalid category'; end if;
  if jsonb_typeof(coalesce(p_goal_matches, '[]'::jsonb)) <> 'array' then raise exception 'Goal matches must be an array'; end if;

  update public.resources set
    title = trim(p_title),
    user_note = nullif(trim(p_user_note), ''),
    content_type = p_content_type,
    estimated_minutes = p_estimated_minutes,
    categories = coalesce(p_categories, '{}'),
    cognitive_effort = greatest(0, least(1, p_cognitive_effort)),
    actionability = greatest(0, least(1, p_actionability)),
    time_sensitivity = greatest(0, least(1, p_time_sensitivity)),
    status = p_status,
    completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
    snoozed_until = null
  where id = p_resource_id and user_id = current_user_id;

  delete from public.resource_goals where resource_id = p_resource_id;
  insert into public.resource_goals (resource_id, goal_id, relevance)
  select p_resource_id, (match->>'goalId')::uuid, greatest(0, least(1, (match->>'relevance')::numeric))
  from jsonb_array_elements(coalesce(p_goal_matches, '[]'::jsonb)) match
  where exists (
    select 1 from public.goals goal
    where goal.id = (match->>'goalId')::uuid and goal.user_id = current_user_id and goal.active
  );
end;
$$;

revoke all on function public.update_profile_settings(text, integer, boolean, time, text, uuid) from public;
revoke all on function public.update_resource_details(uuid, text, text, text, integer, text[], numeric, numeric, numeric, text, jsonb) from public;
grant execute on function public.update_profile_settings(text, integer, boolean, time, text, uuid) to authenticated;
grant execute on function public.update_resource_details(uuid, text, text, text, integer, text[], numeric, numeric, numeric, text, jsonb) to authenticated;
