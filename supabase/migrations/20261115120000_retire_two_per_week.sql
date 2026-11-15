-- Retire the 2x/week membership: no new sign-ups. Existing two_per_week rows
-- (and the enum value) stay, so current members keep working until they cancel.
create or replace function public.create_cash_membership(p_tier membership_tier, p_child_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_period_start timestamptz := date_trunc('month', now());
  v_period_end timestamptz := date_trunc('month', now()) + interval '1 month';
  v_already text := case when p_child_id is null
    then 'You already have an active membership.'
    else 'This child already has an active kids membership.' end;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_tier = 'two_per_week' then
    raise exception 'The 2x per week membership is no longer available. Please choose Unlimited.';
  end if;

  if (p_tier = 'kids') <> (p_child_id is not null) then
    raise exception 'Kids memberships are taken out for a child; adult memberships are not.';
  end if;

  if p_child_id is not null and not exists (
    select 1 from children where id = p_child_id and parent_id = v_user_id
  ) then
    raise exception 'Child not found on this account.' using errcode = '42501';
  end if;

  if exists (
    select 1 from memberships
    where student_id = v_user_id
      and child_id is not distinct from p_child_id
      and status in ('active', 'cancelling', 'past_due')
  ) then
    raise exception '%', v_already;
  end if;

  begin
    insert into memberships (
      student_id, child_id, tier, status,
      payment_method, payment_status,
      current_period_start, current_period_end
    ) values (
      v_user_id, p_child_id, p_tier, 'active',
      'cash', 'pending',
      v_period_start, v_period_end
    )
    returning id into v_membership_id;
  exception when unique_violation then
    -- The one-active-membership indexes guard against a concurrent second
    -- insert slipping past the existence check above.
    raise exception '%', v_already;
  end;

  return v_membership_id;
end;
$function$;
