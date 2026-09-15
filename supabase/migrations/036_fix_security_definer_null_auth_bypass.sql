-- ============================================================
-- SECURITY FIX: NULL-bypass in SECURITY DEFINER auth guards
-- ============================================================
-- Several SECURITY DEFINER functions guard access with patterns like:
--
--   if auth.uid() != p_user_id and get_user_role() != 'admin' then ...
--   if v_role not in ('admin', 'teacher') then ...
--
-- For an anonymous (unauthenticated) caller, auth.uid() and get_user_role()
-- both evaluate to NULL. `NULL != x` and `NULL NOT IN (...)` both evaluate
-- to NULL under SQL's three-valued logic, and plpgsql treats a NULL
-- condition in `IF ... THEN` as FALSE — so the deny branch is silently
-- skipped and the function runs as if the caller were authorised. This is
-- reachable by anyone holding the public anon key (no login required, by
-- design the same key every client of the app already uses).
--
-- Two functions (get_class_roster, get_users_with_late_cancellations,
-- confirm_cash_membership, confirm_cash_block_payment) let an anonymous
-- caller read arbitrary students' rosters/financial data or mark cash
-- payments as confirmed for free. Several others
-- (get_user_payment_history, get_user_owed_amount,
-- get_user_unconfirmed_cash_sessions) leak a specific user's financial
-- history given only their user id. get_late_cancellation_count and
-- is_user_booking_blocked had no auth check at all; the live definition of
-- get_user_late_cancellation_history (confirmed via direct DB
-- introspection — it has drifted from what migration 024 shipped) also had
-- no auth check at all.
--
-- Fix: use `IS DISTINCT FROM` / `v_role IS NULL OR v_role NOT IN (...)` /
-- `coalesce(get_user_role()::text, '')` so a NULL caller identity always
-- resolves to "deny" rather than silently passing through. Also revoke
-- EXECUTE from `anon` on every affected function as defense in depth,
-- matching the remediation Supabase's own advisor linter recommends.
--
-- is_user_booking_blocked and get_late_cancellation_count are also called
-- internally by several Edge Functions via the service-role client with an
-- arbitrary (not-self) p_user_id (e.g. cancel-booking checking the
-- original booking's student, not the caller) — those two get an
-- `auth.role() = 'service_role'` escape hatch so that legitimate internal
-- use keeps working exactly as before.
--
-- NOTE: current_user/session_user do NOT work for this check — inside a
-- SECURITY DEFINER function, current_user is shadowed by the function's
-- OWNER for the duration of the call, and under PostgREST session_user is
-- always the fixed 'authenticator' connection role. auth.role() reads the
-- JWT's role claim directly (the same claim PostgREST itself uses to pick
-- anon/authenticated/service_role), which is what actually distinguishes
-- callers. This was caught by live-testing against the real REST API
-- before merging — an earlier `current_user <> 'service_role'` version of
-- this migration would have broken every Edge Function that calls these
-- two RPCs internally (book-with-membership, cancel-booking,
-- claim-waitlist-spot, cancel-one-to-one, create-payment-intent).
-- ============================================================

-- ── is_user_booking_blocked: previously had no auth check at all ─────────
create or replace function public.is_user_booking_blocked(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role'
     and auth.uid() is distinct from p_user_id
     and coalesce(get_user_role()::text, '') <> 'admin' then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  return
    coalesce((select is_manually_blocked from profiles where id = p_user_id), false)
    or (
      (select count(*)::integer
       from late_cancellations
       where user_id = p_user_id
         and cancelled_at >= date_trunc('month', now())
         and cancelled_at < date_trunc('month', now()) + interval '1 month'
      ) >= 3
      and (
        (select late_cancel_unblocked_until from profiles where id = p_user_id) is null
        or (select late_cancel_unblocked_until from profiles where id = p_user_id)
           < date_trunc('month', now())::date
      )
    );
end;
$function$;

revoke execute on function public.is_user_booking_blocked(uuid) from anon;
revoke execute on function public.is_user_booking_blocked(uuid) from public;

-- ── get_late_cancellation_count: previously had no auth check at all ─────
create or replace function public.get_late_cancellation_count(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role'
     and auth.uid() is distinct from p_user_id
     and coalesce(get_user_role()::text, '') <> 'admin' then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  return (
    select count(*)::integer
    from late_cancellations
    where user_id = p_user_id
      and cancelled_at >= date_trunc('month', now())
      and cancelled_at < date_trunc('month', now()) + interval '1 month'
  );
end;
$function$;

revoke execute on function public.get_late_cancellation_count(uuid) from anon;
revoke execute on function public.get_late_cancellation_count(uuid) from public;

-- ── get_user_payment_history: NULL-bypass on the self-or-admin check ─────
create or replace function public.get_user_payment_history(p_user_id uuid)
returns table(id uuid, amount integer, note text, recorded_by_name text, recorded_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is distinct from p_user_id and coalesce(get_user_role()::text, '') <> 'admin' then
    return;
  end if;

  return query
  select pr.id, pr.amount, pr.note, rb.full_name as recorded_by_name, pr.recorded_at
  from payments_received pr
  left join profiles rb on rb.id = pr.recorded_by
  where pr.user_id = p_user_id
  order by pr.recorded_at desc;
end;
$function$;

revoke execute on function public.get_user_payment_history(uuid) from anon;
revoke execute on function public.get_user_payment_history(uuid) from public;

-- ── get_user_owed_amount: NULL-bypass on the self-or-admin check ─────────
create or replace function public.get_user_owed_amount(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() is distinct from 'service_role'
     and auth.uid() is distinct from p_user_id
     and coalesce(get_user_role()::text, '') <> 'admin' then
    raise exception 'Not authorised to view owed amount for this user.'
      using errcode = '42501';
  end if;

  return (
    with class_owed as (
      select coalesce(sum(coalesce(cs.price, ct.price)), 0)::bigint as total
      from bookings b
      join class_sessions cs on cs.id = b.session_id
      join class_templates ct on ct.id = cs.template_id
      where b.student_id = p_user_id
        and b.payment_method = 'cash'
        and b.payment_status = 'pending'
        and b.status = 'confirmed'
        and cs.is_cancelled = false
        and (cs.session_date + cs.end_time) < now()
    ),
    oto_owed as (
      select coalesce(sum(price), 0)::bigint as total
      from one_to_ones
      where student_id = p_user_id
        and payment_method = 'cash'
        and payment_status = 'pending'
        and status in ('booked', 'completed')
        and (session_date + end_time) < now()
    ),
    membership_owed as (
      select coalesce(sum(membership_tier_price_pence(tier)), 0)::bigint as total
      from memberships
      where student_id = p_user_id
        and payment_method = 'cash'
        and payment_status = 'pending'
        and status in ('active', 'cancelling', 'past_due')
        and current_period_end > now()
    ),
    block_owed as (
      select coalesce(sum(price_pence_snapshot), 0)::bigint as total
      from blocks
      where student_id = p_user_id
        and payment_method = 'cash'
        and payment_status = 'pending'
        and status in ('active', 'exhausted', 'expired')
    ),
    paid_back as (
      select coalesce(sum(amount), 0)::bigint as total
      from payments_received
      where user_id = p_user_id
    )
    select greatest(
      (select total from class_owed)
      + (select total from oto_owed)
      + (select total from membership_owed)
      + (select total from block_owed)
      - (select total from paid_back),
      0
    )::integer
  );
end;
$function$;

revoke execute on function public.get_user_owed_amount(uuid) from anon;
revoke execute on function public.get_user_owed_amount(uuid) from public;

-- ── get_user_unconfirmed_cash_sessions: NULL-bypass on self-or-admin ─────
create or replace function public.get_user_unconfirmed_cash_sessions(p_user_id uuid)
returns table(source_type text, source_id uuid, description text, session_date date, amount integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is distinct from p_user_id and coalesce(get_user_role()::text, '') <> 'admin' then
    raise exception 'Not authorised to view unconfirmed cash sessions for this user.'
      using errcode = '42501';
  end if;

  return query
  select
    'class'::text as source_type,
    b.id as source_id,
    ct.name as description,
    cs.session_date,
    coalesce(cs.price, ct.price) as amount
  from bookings b
  join class_sessions cs on cs.id = b.session_id
  join class_templates ct on ct.id = cs.template_id
  where b.student_id = p_user_id
    and b.payment_method = 'cash'
    and b.payment_status = 'pending'
    and b.status = 'confirmed'
    and cs.is_cancelled = false
    and (cs.session_date + cs.end_time) < now()

  union all

  select
    'one_to_one'::text as source_type,
    o.id as source_id,
    o.title as description,
    o.session_date,
    o.price as amount
  from one_to_ones o
  where o.student_id = p_user_id
    and o.payment_method = 'cash'
    and o.payment_status = 'pending'
    and o.status in ('booked', 'completed')
    and (o.session_date + o.end_time) < now()

  union all

  select
    'membership'::text as source_type,
    m.id as source_id,
    case m.tier
      when 'two_per_week' then 'Membership — 2x per week'
      when 'unlimited' then 'Membership — Unlimited'
    end as description,
    m.created_at::date as session_date,
    membership_tier_price_pence(m.tier) as amount
  from memberships m
  where m.student_id = p_user_id
    and m.payment_method = 'cash'
    and m.payment_status = 'pending'
    and m.status in ('active', 'cancelling', 'past_due')
    and m.current_period_end > now()

  union all

  select
    'block'::text as source_type,
    bk.id as source_id,
    bk.template_name_snapshot || ' (' || bk.sessions_total || ' sessions)' as description,
    bk.created_at::date as session_date,
    bk.price_pence_snapshot as amount
  from blocks bk
  where bk.student_id = p_user_id
    and bk.payment_method = 'cash'
    and bk.payment_status = 'pending'
    and bk.status in ('active', 'exhausted', 'expired')

  order by session_date desc;
end;
$function$;

revoke execute on function public.get_user_unconfirmed_cash_sessions(uuid) from anon;
revoke execute on function public.get_user_unconfirmed_cash_sessions(uuid) from public;

-- ── get_user_late_cancellation_history: previously had NO auth check ─────
-- (Live definition had already drifted from what migration 024 shipped —
-- no `kind`/one-to-one union, and critically no auth guard whatsoever.
-- This restores the self-or-admin guard against the function as it
-- actually exists in production today.)
create or replace function public.get_user_late_cancellation_history(p_user_id uuid)
returns table(id uuid, session_id uuid, class_name text, session_date date, session_start_time text, cancelled_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is distinct from p_user_id and coalesce(get_user_role()::text, '') <> 'admin' then
    return;
  end if;

  return query
  select
    lc.id,
    lc.session_id,
    ct.name as class_name,
    cs.session_date,
    cs.start_time as session_start_time,
    lc.cancelled_at
  from late_cancellations lc
  join class_sessions cs on cs.id = lc.session_id
  join class_templates ct on ct.id = cs.template_id
  where lc.user_id = p_user_id
  order by lc.cancelled_at desc;
end;
$function$;

revoke execute on function public.get_user_late_cancellation_history(uuid) from anon;
revoke execute on function public.get_user_late_cancellation_history(uuid) from public;

-- ── confirm_cash_membership: NULL-bypass let anon mark memberships paid ──
create or replace function public.confirm_cash_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role user_role := get_user_role();
  v_membership memberships%rowtype;
begin
  if v_role is null or v_role not in ('admin', 'teacher') then
    raise exception 'Only admins and teachers can confirm cash memberships.';
  end if;

  select * into v_membership from memberships where id = p_membership_id;

  if not found then
    raise exception 'Membership not found.';
  end if;

  if v_membership.payment_method <> 'cash' then
    raise exception 'Membership is not a cash membership.';
  end if;

  if v_membership.payment_status = 'paid' then
    return;
  end if;

  update memberships
     set payment_status = 'paid',
         cash_confirmed_at = now(),
         cash_confirmed_by = auth.uid()
   where id = p_membership_id;
end;
$function$;

revoke execute on function public.confirm_cash_membership(uuid) from anon;
revoke execute on function public.confirm_cash_membership(uuid) from public;

-- ── confirm_cash_block_payment: NULL-bypass let anon mark blocks paid ────
create or replace function public.confirm_cash_block_payment(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role user_role := get_user_role();
  v_block blocks%rowtype;
begin
  if v_role is null or v_role not in ('admin', 'teacher') then
    raise exception 'Only admins and teachers can confirm cash blocks.';
  end if;

  select * into v_block from blocks where id = p_block_id;
  if not found then
    raise exception 'Block not found.';
  end if;

  if v_block.payment_method <> 'cash' then
    raise exception 'Block is not a cash purchase.';
  end if;

  if v_block.payment_status = 'paid' then
    return; -- idempotent
  end if;

  update blocks
  set payment_status = 'paid',
      cash_confirmed_at = now(),
      cash_confirmed_by = auth.uid()
  where id = p_block_id;
end;
$function$;

revoke execute on function public.confirm_cash_block_payment(uuid) from anon;
revoke execute on function public.confirm_cash_block_payment(uuid) from public;

-- ── get_class_roster: NULL-bypass exposed any session's roster to anon ───
create or replace function public.get_class_roster(p_session_id uuid)
returns table(booking_id uuid, student_id uuid, student_name text, booked_at timestamptz, payment_method text, payment_status text, membership_id uuid, membership_tier text, membership_payment_method text, membership_payment_status text, follow_up_amount_pence integer, cash_pending boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role text := get_user_role();
begin
  if v_role is null or v_role not in ('teacher', 'admin') then
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
$function$;

revoke execute on function public.get_class_roster(uuid) from anon;
revoke execute on function public.get_class_roster(uuid) from public;

-- ── get_users_with_late_cancellations: NULL-bypass exposed the full ──────
-- ── member list (names, roles, membership status, owed amounts) to anon ──
create or replace function public.get_users_with_late_cancellations()
returns table(user_id uuid, full_name text, role text, late_cancellation_count integer, membership_tier text, membership_status text, is_blocked boolean, is_manually_blocked boolean, late_cancel_unblocked_until date, owed_amount integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(get_user_role()::text, '') <> 'admin' then
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

revoke execute on function public.get_users_with_late_cancellations() from anon;
revoke execute on function public.get_users_with_late_cancellations() from public;

-- ── delete_past_one_to_ones: cron/manual cleanup only, no client calls it ─
-- Not referenced by any Edge Function or app code, and not currently even
-- scheduled via pg_cron — but it deletes rows unconditionally, so it should
-- never have been reachable by client roles. Matches the precedent set in
-- 029_secure_class_roster_access.sql for roll_expired_cash_memberships().
create or replace function public.delete_past_one_to_ones()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  deleted_count integer;
begin
  delete from one_to_ones
  where (session_date + start_time) < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

revoke execute on function public.delete_past_one_to_ones() from public;
revoke execute on function public.delete_past_one_to_ones() from anon;
revoke execute on function public.delete_past_one_to_ones() from authenticated;
