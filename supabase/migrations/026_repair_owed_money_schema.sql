-- ============================================================
-- REPAIR: missing pieces of migrations 017 + 018
-- ============================================================
-- schema_migrations claims 017 (owed_money_tracking) and 018
-- (cash_membership_payment) were applied, but the actual DDL never
-- committed on this project. Migration 019 (one_to_one_blocks) ran
-- on top, replacing the owed-money RPCs with bodies that reference
-- 017/018 objects — leaving those RPCs broken at call time.
--
-- This migration restores the missing pieces of 017 and 018, then
-- redefines the RPCs to their final (post-019) shape. Every statement
-- is idempotent so it is safe to re-run, and safe even if some
-- objects happen to exist from a partial application.
-- ============================================================

-- ─── 017: profiles.is_manually_blocked ─────────────────────────────────────
alter table profiles
  add column if not exists is_manually_blocked boolean not null default false;

-- ─── 017: payments_received ────────────────────────────────────────────────
create table if not exists payments_received (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount integer not null check (amount > 0),
  recorded_by uuid references profiles(id) on delete set null,
  note text,
  recorded_at timestamptz not null default now()
);

create index if not exists payments_received_user_id_idx
  on payments_received(user_id);

alter table payments_received enable row level security;

drop policy if exists "Users read own payments_received" on payments_received;
create policy "Users read own payments_received"
  on payments_received for select
  using (user_id = auth.uid());

drop policy if exists "Admins read all payments_received" on payments_received;
create policy "Admins read all payments_received"
  on payments_received for select
  using (get_user_role() = 'admin');

drop policy if exists "Admins manage payments_received" on payments_received;
create policy "Admins manage payments_received"
  on payments_received for all
  using (get_user_role() = 'admin');

-- ─── 018: membership_payment_method type ───────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_payment_method') then
    create type membership_payment_method as enum ('stripe', 'cash');
  end if;
end $$;

-- ─── 018: memberships columns + constraints ────────────────────────────────
alter table memberships alter column stripe_price_id drop not null;

alter table memberships
  add column if not exists payment_method membership_payment_method;
alter table memberships
  add column if not exists payment_status payment_status_type;
alter table memberships
  add column if not exists cash_confirmed_at timestamptz;
alter table memberships
  add column if not exists cash_confirmed_by uuid references profiles(id) on delete set null;

-- Existing rows predate cash memberships and must have come via Stripe.
update memberships
   set payment_method = 'stripe'
 where payment_method is null;
update memberships
   set payment_status = 'paid'
 where payment_status is null;

alter table memberships alter column payment_method set not null;
alter table memberships alter column payment_method set default 'stripe';
alter table memberships alter column payment_status set not null;
alter table memberships alter column payment_status set default 'paid';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'memberships_cash_confirmation_consistent'
  ) then
    alter table memberships
      add constraint memberships_cash_confirmation_consistent
      check (cash_confirmed_by is null or cash_confirmed_at is not null);
  end if;
end $$;

create unique index if not exists memberships_one_active_per_student
  on memberships (student_id)
  where status in ('active', 'cancelling', 'past_due');

-- ─── 018: helper functions ─────────────────────────────────────────────────
create or replace function membership_tier_price_pence(p_tier membership_tier)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'two_per_week' then 8000
    when 'unlimited' then 10000
  end;
$$;

create or replace function membership_cash_grace_expired(p_membership_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select payment_method = 'cash'
        and payment_status = 'pending'
        and (now() - created_at) > interval '72 hours'
      from memberships
      where id = p_membership_id
    ),
    false
  );
$$;

create or replace function create_cash_membership(p_tier membership_tier)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_period_start timestamptz := date_trunc('month', now());
  v_period_end timestamptz := date_trunc('month', now()) + interval '1 month';
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if exists (
    select 1 from memberships
    where student_id = v_user_id
      and status in ('active', 'cancelling', 'past_due')
  ) then
    raise exception 'You already have an active membership.';
  end if;

  begin
    insert into memberships (
      student_id, tier, status,
      payment_method, payment_status,
      current_period_start, current_period_end
    ) values (
      v_user_id, p_tier, 'active',
      'cash', 'pending',
      v_period_start, v_period_end
    )
    returning id into v_membership_id;
  exception when unique_violation then
    raise exception 'You already have an active membership.';
  end;

  return v_membership_id;
end;
$$;

grant execute on function create_cash_membership(membership_tier) to authenticated;

create or replace function confirm_cash_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := get_user_role();
  v_membership memberships%rowtype;
begin
  if v_role not in ('admin', 'teacher') then
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
$$;

grant execute on function confirm_cash_membership(uuid) to authenticated;

-- ─── 017: is_user_booking_blocked (factors in is_manually_blocked) ─────────
create or replace function is_user_booking_blocked(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
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
$$;

-- ─── 017: payment history RPC ──────────────────────────────────────────────
create or replace function get_user_payment_history(p_user_id uuid)
returns table (
  id uuid,
  amount integer,
  note text,
  recorded_by_name text,
  recorded_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() != p_user_id and get_user_role() != 'admin' then
    return;
  end if;

  return query
  select pr.id, pr.amount, pr.note, rb.full_name as recorded_by_name, pr.recorded_at
  from payments_received pr
  left join profiles rb on rb.id = pr.recorded_by
  where pr.user_id = p_user_id
  order by pr.recorded_at desc;
end;
$$;

-- ─── Refreshed owed-money RPCs (final post-019 shape) ──────────────────────
create or replace function get_user_owed_amount(p_user_id uuid)
returns integer
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() != p_user_id and get_user_role() != 'admin' then
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
$$;

create or replace function get_user_unconfirmed_cash_sessions(p_user_id uuid)
returns table (
  source_type text,
  source_id uuid,
  description text,
  session_date date,
  amount integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() != p_user_id and get_user_role() != 'admin' then
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
$$;

-- ─── 017: admin users-list RPC (now includes owed_amount + is_manually_blocked) ──
drop function if exists get_users_with_late_cancellations();

create or replace function get_users_with_late_cancellations()
returns table (
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
security definer
stable
set search_path = public
as $$
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
  order by
    get_user_owed_amount(p.id) desc,
    coalesce(lc.cnt, 0) desc,
    p.full_name asc;
end;
$$;
