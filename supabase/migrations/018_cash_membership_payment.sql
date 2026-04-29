-- ============================================================
-- CASH MEMBERSHIP PAYMENT (issue #10)
-- ============================================================
-- Memberships can now be paid with cash. A cash membership is
-- active immediately, but unusable for new bookings if it has been
-- pending confirmation for more than 72 hours. Owed amount picks up
-- unconfirmed cash memberships alongside class/1-to-1 cash bookings.
-- ============================================================

create type membership_payment_method as enum ('stripe', 'cash');

-- Cash memberships have no Stripe references, so make these nullable.
alter table memberships alter column stripe_price_id drop not null;

alter table memberships add column payment_method membership_payment_method;
alter table memberships add column payment_status payment_status_type;
alter table memberships add column cash_confirmed_at timestamptz;
alter table memberships add column cash_confirmed_by uuid references profiles(id) on delete set null;

-- Existing rows are all Stripe-paid
update memberships
set payment_method = 'stripe',
    payment_status = 'paid'
where payment_method is null;

alter table memberships alter column payment_method set not null;
alter table memberships alter column payment_method set default 'stripe';
alter table memberships alter column payment_status set not null;
alter table memberships alter column payment_status set default 'paid';

-- Cash memberships must have a confirmation pair set together.
alter table memberships add constraint memberships_cash_confirmation_consistent check (
  (cash_confirmed_at is null) = (cash_confirmed_by is null)
);

-- ============================================================
-- TIER PRICING
-- ============================================================
-- Mirrors MEMBERSHIP_PRICES_PENCE in constants/index.ts; if those
-- change, update this function too.
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

-- ============================================================
-- GRACE PERIOD
-- ============================================================

-- Returns true if the membership is cash, still pending, and the
-- 72-hour grace window has elapsed. Used by booking flows to gate
-- membership-paid bookings.
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

-- ============================================================
-- CREATE / CONFIRM CASH MEMBERSHIP
-- ============================================================

-- Student creates an unconfirmed cash membership. Activates
-- immediately, period anchored to the start of the current month
-- (matching the Stripe subscription anchor).
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

  return v_membership_id;
end;
$$;

grant execute on function create_cash_membership(membership_tier) to authenticated;

-- Admin or teacher confirms a pending cash membership.
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

  select * into v_membership
  from memberships
  where id = p_membership_id;

  if not found then
    raise exception 'Membership not found.';
  end if;

  if v_membership.payment_method <> 'cash' then
    raise exception 'Membership is not a cash membership.';
  end if;

  if v_membership.payment_status = 'paid' then
    return; -- already confirmed, idempotent
  end if;

  update memberships
  set payment_status = 'paid',
      cash_confirmed_at = now(),
      cash_confirmed_by = auth.uid()
  where id = p_membership_id;
end;
$$;

grant execute on function confirm_cash_membership(uuid) to authenticated;

-- ============================================================
-- OWED AMOUNT: include unconfirmed cash memberships
-- ============================================================

create or replace function get_user_owed_amount(p_user_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
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
    - (select total from paid_back),
    0
  )::integer;
$$;

-- ============================================================
-- UNCONFIRMED CASH BREAKDOWN: include cash memberships
-- ============================================================
-- The breakdown UI shows each pending item alongside its amount.
-- Memberships join in as source_type = 'membership'.

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
    return;
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

  order by session_date desc;
end;
$$;
