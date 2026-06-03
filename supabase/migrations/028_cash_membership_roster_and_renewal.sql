-- Cash membership UX:
--   * Roster RPC surfaces the underlying membership's cash status so
--     teachers can collect £80/£100 follow-ups directly from the class
--     roster (mirrors the existing cash-block UX on 1-to-1s).
--   * Monthly renewal job rolls cash memberships forward at month
--     boundary and resets payment_status to 'pending'. Without this,
--     cash memberships go stale at period end and the student can no
--     longer use them.

-- pg_cron must be enabled on the project. On Supabase: Dashboard →
-- Database → Extensions → pg_cron. Statement is a no-op if already on.
create extension if not exists pg_cron;

-- =========================================================
-- 1. Roster RPC — enriched with payment context
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
-- 2. Monthly renewal — roll cash memberships forward, mark
--    cancelling ones as fully cancelled at period end.
-- =========================================================
create or replace function roll_expired_cash_memberships()
returns table (
  renewed integer,
  cancelled integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_renewed integer;
  v_cancelled integer;
begin
  update memberships
  set
    current_period_start = date_trunc('month', now()),
    current_period_end   = date_trunc('month', now()) + interval '1 month',
    payment_status       = 'pending'
  where payment_method = 'cash'
    and status = 'active'
    and current_period_end <= now();
  get diagnostics v_renewed = row_count;

  update memberships
  set status = 'cancelled'
  where payment_method = 'cash'
    and status = 'cancelling'
    and current_period_end <= now();
  get diagnostics v_cancelled = row_count;

  return query select v_renewed, v_cancelled;
end;
$$;

-- Lock down the SECURITY DEFINER renewal job: Postgres grants EXECUTE to
-- PUBLIC by default. Only the pg_cron job (running as a privileged role)
-- should ever invoke this, so strip EXECUTE from client-facing roles.
revoke execute on function roll_expired_cash_memberships() from public;
revoke execute on function roll_expired_cash_memberships() from anon;
revoke execute on function roll_expired_cash_memberships() from authenticated;

-- =========================================================
-- 3. Schedule the monthly job — 00:01 on day 1 of each month
-- =========================================================
-- pg_cron uses UTC. Memberships are anchored to date_trunc('month', now())
-- which evaluates in the cron job's UTC context, matching the create flow.
-- We use a guard insert/update to make the schedule idempotent.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'roll-cash-memberships') then
    perform cron.unschedule('roll-cash-memberships');
  end if;
  perform cron.schedule(
    'roll-cash-memberships',
    '1 0 1 * *',
    'select roll_expired_cash_memberships();'
  );
end;
$$;
