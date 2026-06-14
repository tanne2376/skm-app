-- ============================================================
-- EXCLUDE SOFT-DELETED PROFILES FROM ADMIN USERS LIST
-- ============================================================
-- The Manage → Users tab calls get_users_with_late_cancellations to
-- list every member. The previous version did not filter on
-- profiles.deleted_at, so accounts that had been deleted via the
-- delete-account edge function (Apple 5.1.1(v) flow) still appeared
-- in the admin list with their anonymised name.
--
-- Idempotent — `create or replace` keeps the same signature.
-- ============================================================

create or replace function public.get_users_with_late_cancellations()
returns table(
  user_id uuid,
  full_name text,
  role text,
  late_cancellation_count integer,
  membership_tier text,
  membership_status text,
  is_blocked boolean,
  is_manually_blocked boolean,
  late_cancel_unblocked_until date,
  owed_amount integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if get_user_role() != 'admin' then
    return;
  end if;

  return query
  select
    p.id as user_id,
    p.full_name,
    p.role::text,
    coalesce(lc.cnt, 0)::integer as late_cancellation_count,
    m.tier::text as membership_tier,
    m.status::text as membership_status,
    (
      p.is_manually_blocked
      or (
        coalesce(lc.cnt, 0) >= 3
        and (
          p.late_cancel_unblocked_until is null
          or p.late_cancel_unblocked_until < date_trunc('month', now())::date
        )
      )
    ) as is_blocked,
    p.is_manually_blocked,
    p.late_cancel_unblocked_until,
    get_user_owed_amount(p.id) as owed_amount
  from profiles p
  left join lateral (
    select count(*)::integer as cnt
    from late_cancellations
    where late_cancellations.user_id = p.id
      and cancelled_at >= date_trunc('month', now())
      and cancelled_at < date_trunc('month', now()) + interval '1 month'
  ) lc on true
  left join lateral (
    select tier, status
    from memberships
    where student_id = p.id
      and status in ('active', 'cancelling')
    order by created_at desc
    limit 1
  ) m on true
  where p.deleted_at is null
  order by
    owed_amount desc,
    coalesce(lc.cnt, 0) desc,
    p.full_name asc;
end;
$function$;
