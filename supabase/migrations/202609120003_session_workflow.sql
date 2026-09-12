alter table public.interactions
  drop constraint interactions_event_type_check,
  add constraint interactions_event_type_check
    check (event_type in ('opened', 'completed', 'useful', 'not_useful', 'snoozed', 'archived', 'created_action', 'replaced', 'skipped'));

create or replace function public.create_recommendation_session(
  p_time_budget_minutes integer,
  p_energy_mode text,
  p_items jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  new_session_id uuid;
  item_count integer;
  valid_resource_count integer;
  selected_minutes integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_time_budget_minutes not between 1 and 240 then
    raise exception 'Invalid time budget';
  end if;

  if p_energy_mode not in ('quick', 'balanced', 'focused', 'surprise') then
    raise exception 'Invalid energy mode';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Session items must be an array';
  end if;

  item_count := jsonb_array_length(p_items);
  if item_count not between 1 and 50 then
    raise exception 'A session must contain between 1 and 50 resources';
  end if;

  select count(distinct r.id), coalesce(sum(r.estimated_minutes), 0)
    into valid_resource_count, selected_minutes
  from jsonb_array_elements(p_items) item
  join public.resources r on r.id = (item->>'resource_id')::uuid
  where r.user_id = current_user_id
    and (
      r.status = 'active'
      or (r.status = 'snoozed' and r.snoozed_until is not null and r.snoozed_until <= now())
    );

  if valid_resource_count <> item_count then
    raise exception 'Session contains duplicate, missing, inactive, or unauthorized resources';
  end if;

  if selected_minutes > p_time_budget_minutes then
    raise exception 'Selected resources exceed the session time budget';
  end if;

  update public.resources r
  set status = 'active', snoozed_until = null
  where r.user_id = current_user_id
    and r.status = 'snoozed'
    and r.snoozed_until <= now()
    and r.id in (
      select (item->>'resource_id')::uuid
      from jsonb_array_elements(p_items) item
    );

  insert into public.sessions (user_id, time_budget_minutes, energy_mode)
  values (current_user_id, p_time_budget_minutes, p_energy_mode)
  returning id into new_session_id;

  insert into public.session_items (session_id, resource_id, position, score, explanation)
  select
    new_session_id,
    (item->>'resource_id')::uuid,
    (item->>'position')::integer,
    (item->>'score')::numeric,
    left(item->>'explanation', 1000)
  from jsonb_array_elements(p_items) item;

  return new_session_id;
end;
$$;

create or replace function public.record_resource_outcome(
  p_session_id uuid,
  p_resource_id uuid,
  p_outcome text,
  p_snoozed_until timestamptz default null,
  p_time_spent_seconds integer default null
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

  if p_outcome not in ('completed', 'snoozed', 'archived', 'skipped') then
    raise exception 'Invalid resource outcome';
  end if;

  if p_time_spent_seconds is not null and p_time_spent_seconds < 0 then
    raise exception 'Time spent cannot be negative';
  end if;

  if p_outcome = 'snoozed' and (p_snoozed_until is null or p_snoozed_until <= now()) then
    raise exception 'Snoozed resources require a future date';
  end if;

  if not exists (
    select 1
    from public.session_items si
    join public.sessions s on s.id = si.session_id
    join public.resources r on r.id = si.resource_id
    where si.session_id = p_session_id
      and si.resource_id = p_resource_id
      and s.user_id = current_user_id
      and r.user_id = current_user_id
  ) then
    raise exception 'Session resource not found';
  end if;

  update public.session_items
  set outcome = p_outcome,
      time_spent_seconds = p_time_spent_seconds
  where session_id = p_session_id and resource_id = p_resource_id;

  if p_outcome = 'completed' then
    update public.resources
    set status = 'completed', completed_at = now(), snoozed_until = null
    where id = p_resource_id and user_id = current_user_id;
  elsif p_outcome = 'snoozed' then
    update public.resources
    set status = 'snoozed', snoozed_until = p_snoozed_until
    where id = p_resource_id and user_id = current_user_id;
  elsif p_outcome = 'archived' then
    update public.resources
    set status = 'archived', snoozed_until = null
    where id = p_resource_id and user_id = current_user_id;
  end if;

  insert into public.interactions (user_id, resource_id, event_type, metadata)
  values (
    current_user_id,
    p_resource_id,
    p_outcome,
    jsonb_build_object(
      'session_id', p_session_id,
      'time_spent_seconds', p_time_spent_seconds,
      'snoozed_until', p_snoozed_until
    )
  );
end;
$$;

create or replace function public.finish_recommendation_session(
  p_session_id uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.sessions
  set completed_at = now()
  where id = p_session_id and user_id = auth.uid();

  if not found then
    raise exception 'Session not found';
  end if;
end;
$$;

revoke all on function public.create_recommendation_session(integer, text, jsonb) from public;
revoke all on function public.record_resource_outcome(uuid, uuid, text, timestamptz, integer) from public;
revoke all on function public.finish_recommendation_session(uuid) from public;

grant execute on function public.create_recommendation_session(integer, text, jsonb) to authenticated;
grant execute on function public.record_resource_outcome(uuid, uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.finish_recommendation_session(uuid) to authenticated;
