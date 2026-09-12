-- Claim a pairing code atomically.
--
-- The route previously checked used_at, inserted a permanent token, then marked the code
-- used. Two concurrent requests could both pass the check and both receive a working
-- token for one code. A conditional UPDATE ... RETURNING makes the claim itself the
-- exclusive operation: only one transaction can flip used_at from null, and only that
-- caller gets a row back.

create or replace function public.claim_pairing_code(
  p_code text,
  p_token_hash text,
  p_label text default 'Chrome'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_user_id uuid;
begin
  update public.pairing_codes
  set used_at = now()
  where code = p_code
    and used_at is null
    and expires_at > now()
  returning user_id into claimed_user_id;

  -- Unknown, already used, or expired all look identical to the caller on purpose,
  -- so this cannot be used to probe which codes exist.
  if claimed_user_id is null then
    return null;
  end if;

  insert into public.extension_tokens (user_id, token_hash, label)
  values (claimed_user_id, p_token_hash, coalesce(p_label, 'Chrome'));

  insert into public.connections (
    user_id, provider, external_account_id, external_account_label, status, updated_at
  )
  values (
    claimed_user_id, 'browser_bookmark', 'chrome', coalesce(p_label, 'Chrome'), 'active', now()
  )
  on conflict (user_id, provider, external_account_id) do update
    set status = 'active',
        external_account_label = excluded.external_account_label,
        updated_at = now();

  return claimed_user_id;
end;
$$;

-- security definer, so lock it down to the anon role the extension actually calls with.
revoke all on function public.claim_pairing_code(text, text, text) from public;
grant execute on function public.claim_pairing_code(text, text, text) to anon, authenticated;
