-- Security hardening for migration 028 (from code review).
--
-- 028 edited two objects in place. Because migrations are only applied
-- once per recorded version, databases that already ran 028 would NOT
-- pick up those edits via `supabase db push`. This migration re-applies
-- them as idempotent statements so every environment converges:
--
--   1. get_class_roster() — add a teacher session-ownership check. The
--      function is SECURITY DEFINER (RLS is bypassed inside it), so any
--      teacher could previously fetch ANY session's roster by passing an
--      arbitrary p_session_id. Restrict non-admin teachers to sessions
--      they teach (class_sessions.teacher_id = auth.uid()), matching the
--      RLS convention in 002_rls.sql. Admins are unchanged.
--
--   2. roll_expired_cash_memberships() — revoke EXECUTE from client roles.
--      Postgres grants EXECUTE to PUBLIC by default; this SECURITY DEFINER
--      renewal job should only ever run from the pg_cron schedule.
--
-- All statements are create-or-replace / revoke, safe to run repeatedly.

-- =========================================================
-- 1. Roster RPC — teacher ownership guard added
-- =========================================================
create or replace function get_class_roster(p_session_id uuid)
returns table (
  booking_id uuid,
  student_id uuid,
  student_name text,
  booked_at timestamptz,
  payment_method text,
  payment_status text,
  membership_id uuid,
  membership_tier text,
  membership_payment_method text,
  membership_payment_status text,
  follow_up_amount_pence integer,
  cash_pending boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_user_role();
begin
  if v_role not in ('teacher', 'admin') then
    raise exception 'Only teachers and admins can view class rosters.';
  end if;

  -- Teachers may only view rosters for sessions they teach; admins see all.
  -- This function is SECURITY DEFINER so RLS does not apply — the ownership
  -- check must be explicit here (matches the teacher_id = auth.uid() pattern
  -- used by the class_sessions RLS policies in 002_rls.sql).
  if v_role = 'teacher'
     and not exists (
       select 1
       from class_sessions s
       where s.id = p_session_id
         and s.teacher_id = auth.uid()
     ) then
    raise exception 'Teachers can only view rosters for their own sessions.';
  end if;

  return query
  with class_price as (
    select coalesce(s.price, t.price) as price
    from class_sessions s
    join class_templates t on t.id = s.template_id
    where s.id = p_session_id
  )
  select
    b.id                                                                   as booking_id,
    b.student_id,
    p.full_name                                                            as student_name,
    b.booked_at,
    b.payment_method::text                                                 as payment_method,
    b.payment_status::text                                                 as payment_status,
    m.id                                                                   as membership_id,
    m.tier::text                                                           as membership_tier,
    m.payment_method::text                                                 as membership_payment_method,
    m.payment_status::text                                                 as membership_payment_status,
    case
      when b.payment_method = 'membership' and m.tier = 'two_per_week' then 8000
      when b.payment_method = 'membership' and m.tier = 'unlimited'    then 10000
      when b.payment_method = 'cash'                                  then (select price from class_price)
      else null
    end                                                                    as follow_up_amount_pence,
    case
      when b.payment_method = 'cash' and b.payment_status = 'pending'                                         then true
      when b.payment_method = 'membership' and m.payment_method = 'cash' and m.payment_status = 'pending'     then true
      else false
    end                                                                    as cash_pending
  from bookings b
  join profiles p on p.id = b.student_id
  left join lateral (
    select *
    from memberships mi
    where mi.student_id = b.student_id
      and mi.status in ('active', 'cancelling')
    order by mi.created_at desc
    limit 1
  ) m on b.payment_method = 'membership'
  where b.session_id = p_session_id
    and b.status = 'confirmed'
  order by b.booked_at asc;
end;
$$;

grant execute on function get_class_roster(uuid) to authenticated;

-- =========================================================
-- 2. Lock down the SECURITY DEFINER renewal job
-- =========================================================
revoke execute on function roll_expired_cash_memberships() from public;
revoke execute on function roll_expired_cash_memberships() from anon;
revoke execute on function roll_expired_cash_memberships() from authenticated;
