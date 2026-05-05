-- ============================================================
-- 1-TO-1 PREPAID SESSION BLOCKS (issue #9)
-- ============================================================
-- Admin-defined block templates (N sessions valid for D days, fixed
-- price). Students purchase a block from the Membership page; one
-- active block per student. Booking a 1-to-1 while a block is active
-- skips payment and decrements the remaining sessions.
-- ============================================================

-- 'block' joins the existing payment method enum so bookings/1-to-1s
-- can record that a slot was paid for via a block. Enum values added
-- here are only used inside plpgsql function bodies (parsed lazily),
-- not in CHECK/DEFAULT/DML, so this is safe inside the migration tx.
alter type payment_method_type add value if not exists 'block';

create type block_status as enum (
  'pending_stripe', -- Stripe block awaiting payment intent success
  'active',         -- usable: has remaining sessions and not expired
  'exhausted',      -- terminal: sessions_used = sessions_total
  'expired',        -- terminal: expires_at passed before exhausted
  'cancelled'       -- terminal: failed Stripe or user/admin cancel
);

create type block_payment_method as enum ('stripe', 'cash');

-- ============================================================
-- TEMPLATES (admin-defined)
-- ============================================================

create table block_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  sessions_count smallint not null check (sessions_count > 0),
  -- null validity_days = block never expires
  validity_days integer check (validity_days is null or validity_days > 0),
  price_pence integer not null check (price_pence >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index block_templates_active_idx on block_templates(is_active);

-- ============================================================
-- BLOCKS (purchased)
-- ============================================================

create table blocks (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete restrict,
  template_id uuid not null references block_templates(id) on delete restrict,

  -- Snapshot of template at purchase time so later edits to the
  -- template don't retroactively change historical purchases.
  template_name_snapshot text not null,
  sessions_total smallint not null check (sessions_total > 0),
  validity_days_snapshot integer check (validity_days_snapshot is null or validity_days_snapshot > 0),
  price_pence_snapshot integer not null check (price_pence_snapshot >= 0),

  status block_status not null default 'pending_stripe',
  payment_method block_payment_method not null,
  payment_status payment_status_type not null default 'pending',
  sessions_used smallint not null default 0 check (sessions_used >= 0),

  -- Cash confirmation. Mirrors memberships' cash columns; FK is set null
  -- on confirmer profile delete to preserve the historical timestamp.
  cash_confirmed_at timestamptz,
  cash_confirmed_by uuid references profiles(id) on delete set null,

  stripe_payment_intent_id text unique,

  created_at timestamptz not null default now(),
  -- For Stripe blocks, set when webhook flips to active. For cash
  -- blocks, equals created_at (active immediately).
  activated_at timestamptz,
  -- Set at activation: created_at + validity_days for cash, now() at
  -- webhook for Stripe. Null = never expires.
  expires_at timestamptz,

  constraint blocks_sessions_within_total check (sessions_used <= sessions_total),
  constraint blocks_cash_confirmation_consistent check (
    cash_confirmed_by is null or cash_confirmed_at is not null
  )
);

create index blocks_student_id_idx on blocks(student_id);
create index blocks_template_id_idx on blocks(template_id);
create index blocks_status_idx on blocks(status);

-- One usable block per student. pending_stripe rows are excluded so a
-- failed checkout doesn't lock the student out of buying again.
create unique index blocks_one_active_per_student
  on blocks (student_id)
  where status = 'active';

-- ============================================================
-- ONE_TO_ONES: link to the block that paid for it
-- ============================================================

alter table one_to_ones add column block_id uuid references blocks(id) on delete set null;
create index one_to_ones_block_id_idx on one_to_ones(block_id);

-- ============================================================
-- RLS
-- ============================================================

alter table block_templates enable row level security;
alter table blocks enable row level security;

create policy "Anyone read active block templates"
  on block_templates for select
  using (is_active = true or get_user_role() = 'admin');

create policy "Admins manage block templates"
  on block_templates for all
  using (get_user_role() = 'admin');

create policy "Students read own blocks"
  on blocks for select
  using (student_id = auth.uid());

create policy "Teachers and admins read all blocks"
  on blocks for select
  using (get_user_role() in ('teacher', 'admin'));

create policy "Admins manage blocks"
  on blocks for all
  using (get_user_role() = 'admin');

-- ============================================================
-- GRACE PERIOD (mirrors membership_cash_grace_expired)
-- ============================================================

create or replace function block_cash_grace_expired(p_block_id uuid)
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
      from blocks
      where id = p_block_id
    ),
    false
  );
$$;

-- ============================================================
-- PURCHASE: CASH
-- ============================================================

create or replace function create_cash_block_purchase(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template block_templates%rowtype;
  v_block_id uuid;
  v_now timestamptz := now();
  v_expires_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_template from block_templates where id = p_template_id;
  if not found or not v_template.is_active then
    raise exception 'Block template not available.';
  end if;

  if v_template.validity_days is not null then
    v_expires_at := v_now + (v_template.validity_days || ' days')::interval;
  end if;

  begin
    insert into blocks (
      student_id, template_id,
      template_name_snapshot, sessions_total, validity_days_snapshot, price_pence_snapshot,
      status, payment_method, payment_status,
      activated_at, expires_at
    ) values (
      v_user_id, v_template.id,
      v_template.name, v_template.sessions_count, v_template.validity_days, v_template.price_pence,
      'active', 'cash', 'pending',
      v_now, v_expires_at
    )
    returning id into v_block_id;
  exception when unique_violation then
    -- blocks_one_active_per_student guards a concurrent second insert
    raise exception 'You already have an active block.';
  end;

  return v_block_id;
end;
$$;

grant execute on function create_cash_block_purchase(uuid) to authenticated;

-- ============================================================
-- PURCHASE: STRIPE (pending row, activated by webhook)
-- ============================================================

create or replace function create_pending_stripe_block_purchase(p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template block_templates%rowtype;
  v_block_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_template from block_templates where id = p_template_id;
  if not found or not v_template.is_active then
    raise exception 'Block template not available.';
  end if;

  -- Block parallel checkouts: one active block already covers the user.
  if exists (
    select 1 from blocks where student_id = v_user_id and status = 'active'
  ) then
    raise exception 'You already have an active block.';
  end if;

  -- Block runaway pending Stripe purchases (multi-tap, abandoned sheet).
  if exists (
    select 1 from blocks
    where student_id = v_user_id
      and status = 'pending_stripe'
      and created_at > now() - interval '15 minutes'
  ) then
    raise exception 'A block purchase is already in progress. Try again in a few minutes.';
  end if;

  insert into blocks (
    student_id, template_id,
    template_name_snapshot, sessions_total, validity_days_snapshot, price_pence_snapshot,
    status, payment_method, payment_status
  ) values (
    v_user_id, v_template.id,
    v_template.name, v_template.sessions_count, v_template.validity_days, v_template.price_pence,
    'pending_stripe', 'stripe', 'pending'
  )
  returning id into v_block_id;

  return v_block_id;
end;
$$;

grant execute on function create_pending_stripe_block_purchase(uuid) to authenticated;

-- Edge function fills in the payment_intent_id after Stripe creates one.
-- Restricted to service role; not granted to authenticated.
create or replace function set_block_stripe_payment_intent(p_block_id uuid, p_payment_intent_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update blocks
  set stripe_payment_intent_id = p_payment_intent_id
  where id = p_block_id
    and status = 'pending_stripe'
    and stripe_payment_intent_id is null;
end;
$$;

-- ============================================================
-- WEBHOOK: ACTIVATE / FAIL STRIPE BLOCK
-- ============================================================

create or replace function activate_block_from_stripe(p_payment_intent_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block blocks%rowtype;
  v_now timestamptz := now();
  v_expires_at timestamptz;
begin
  select * into v_block from blocks where stripe_payment_intent_id = p_payment_intent_id;
  if not found then
    raise exception 'Block not found for payment intent %', p_payment_intent_id;
  end if;

  -- Idempotent: webhook can fire more than once.
  if v_block.status = 'active' then
    return v_block.id;
  end if;

  if v_block.status <> 'pending_stripe' then
    -- Late success after we already cancelled (rare). Don't resurrect.
    return v_block.id;
  end if;

  if v_block.validity_days_snapshot is not null then
    v_expires_at := v_now + (v_block.validity_days_snapshot || ' days')::interval;
  end if;

  begin
    update blocks
    set status = 'active',
        payment_status = 'paid',
        activated_at = v_now,
        expires_at = v_expires_at
    where id = v_block.id;
  exception when unique_violation then
    -- The user somehow has another active block by the time the webhook
    -- fires. Cancel this one rather than block both.
    update blocks set status = 'cancelled' where id = v_block.id;
    raise exception 'User already has an active block; this Stripe purchase cancelled.';
  end;

  return v_block.id;
end;
$$;

create or replace function activate_block_failed_from_stripe(p_payment_intent_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update blocks
  set status = 'cancelled'
  where stripe_payment_intent_id = p_payment_intent_id
    and status = 'pending_stripe';
end;
$$;

-- ============================================================
-- CONFIRM CASH PAYMENT (admin / teacher)
-- ============================================================

create or replace function confirm_cash_block_payment(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := get_user_role();
  v_block blocks%rowtype;
begin
  if v_role not in ('admin', 'teacher') then
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
$$;

grant execute on function confirm_cash_block_payment(uuid) to authenticated;

-- ============================================================
-- CANCEL: free the slot so the user can buy a new block
-- ============================================================
-- v1 only allows cancelling a block that is no longer usable
-- (exhausted/expired) — purely for the slot-replacement use case.
-- Admins can force-cancel any active block.

create or replace function cancel_block(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role := get_user_role();
  v_block blocks%rowtype;
  v_is_owner boolean;
begin
  select * into v_block from blocks where id = p_block_id;
  if not found then
    raise exception 'Block not found.';
  end if;

  v_is_owner := (v_block.student_id = auth.uid());

  if not v_is_owner and v_role <> 'admin' then
    raise exception 'Not authorised to cancel this block.';
  end if;

  if v_block.status not in ('active', 'exhausted', 'expired') then
    raise exception 'Block is not cancellable.';
  end if;

  -- Owner can only cancel a block that's no longer usable (avoids
  -- accidental forfeit of remaining sessions).
  if v_is_owner and v_role <> 'admin' then
    if v_block.status = 'active'
       and v_block.sessions_used < v_block.sessions_total
       and (v_block.expires_at is null or v_block.expires_at > now()) then
      raise exception 'Cannot cancel a block that still has sessions remaining.';
    end if;
  end if;

  update blocks set status = 'cancelled' where id = p_block_id;
end;
$$;

grant execute on function cancel_block(uuid) to authenticated;

-- ============================================================
-- BOOK 1-TO-1 WITH BLOCK
-- ============================================================

create or replace function book_one_to_one_with_block(p_one_to_one_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_block blocks%rowtype;
  v_oto one_to_ones%rowtype;
  v_new_used smallint;
  v_new_status block_status;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if is_user_booking_blocked(v_user_id) then
    raise exception 'Booking is currently blocked. Please contact a class leader.'
      using errcode = '42501';
  end if;

  -- Lock the active block row to serialize concurrent bookings.
  select * into v_block
  from blocks
  where student_id = v_user_id and status = 'active'
  for update;

  if not found then
    raise exception 'You do not have an active block.';
  end if;

  -- Lazy expiry: transition to terminal state and surface a clear error.
  if v_block.expires_at is not null and v_block.expires_at < now() then
    update blocks set status = 'expired' where id = v_block.id;
    raise exception 'Your block has expired.';
  end if;

  if v_block.sessions_used >= v_block.sessions_total then
    update blocks set status = 'exhausted' where id = v_block.id;
    raise exception 'Your block has no sessions remaining.';
  end if;

  if v_block.payment_method = 'cash'
     and v_block.payment_status = 'pending'
     and (now() - v_block.created_at) > interval '72 hours' then
    raise exception 'Your cash block payment must be confirmed by a class leader before you can book.';
  end if;

  -- Lock and update the 1-to-1 row to prevent races against other bookers.
  select * into v_oto from one_to_ones where id = p_one_to_one_id for update;
  if not found then
    raise exception 'Session not found.';
  end if;
  if v_oto.status <> 'available' then
    raise exception 'Session is no longer available.';
  end if;
  if v_oto.creator_id = v_user_id then
    raise exception 'You cannot book your own session.';
  end if;

  update one_to_ones
  set student_id = v_user_id,
      status = 'booked',
      payment_method = 'block',
      payment_status = 'paid',
      block_id = v_block.id
  where id = p_one_to_one_id;

  v_new_used := v_block.sessions_used + 1;
  v_new_status := case when v_new_used = v_block.sessions_total then 'exhausted'::block_status
                       else v_block.status end;

  update blocks
  set sessions_used = v_new_used,
      status = v_new_status
  where id = v_block.id;

  return p_one_to_one_id;
end;
$$;

grant execute on function book_one_to_one_with_block(uuid) to authenticated;

-- ============================================================
-- REFUND BLOCK SLOT (called from cancel-one-to-one edge function)
-- ============================================================
-- Returns a session to the block when a block-paid 1-to-1 is cancelled
-- outside the no-refund window. The edge function decides whether to
-- call this; we just mutate state here.

create or replace function refund_block_slot(p_block_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block blocks%rowtype;
begin
  -- Called only from the service role (cancel-one-to-one edge function),
  -- which has authorised the cancellation via its own checks. No grant to
  -- authenticated, so end users can't call this directly.

  select * into v_block from blocks where id = p_block_id for update;
  if not found then
    raise exception 'Block not found.';
  end if;

  if v_block.sessions_used <= 0 then
    return; -- nothing to refund
  end if;

  update blocks
  set sessions_used = sessions_used - 1,
      -- If we were exhausted purely because we hit the cap, going back
      -- under the cap re-activates us — but only if there's no other
      -- active block and we haven't expired.
      status = case
        when v_block.status = 'exhausted'
             and (v_block.expires_at is null or v_block.expires_at > now())
             and not exists (
               select 1 from blocks
               where student_id = v_block.student_id
                 and status = 'active'
                 and id <> v_block.id
             )
          then 'active'::block_status
        else v_block.status
      end
  where id = p_block_id;
end;
$$;

-- ============================================================
-- OWED AMOUNT: include unconfirmed cash blocks
-- ============================================================

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
      -- Cash for the block is owed once purchased and unconfirmed,
      -- regardless of consumption. Cancelled blocks drop out (the user
      -- explicitly relinquished them).
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

-- ============================================================
-- UNCONFIRMED CASH BREAKDOWN: include blocks
-- ============================================================

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
