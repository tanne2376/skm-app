-- ============================================================
-- OWED MONEY TRACKING (issue #8)
-- ============================================================
-- Owed amount = sum of unconfirmed cash bookings (classes + 1-to-1s)
-- whose session is in the past, minus admin-recorded payments.
-- No new write happens when a session ends — owed is derived.
-- ============================================================

-- Manual admin block flag, separate from late-cancellation auto-block
alter table profiles add column is_manually_blocked boolean not null default false;

-- Admin-recorded paybacks against a user's owed total
create table payments_received (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount integer not null check (amount > 0), -- pence
  recorded_by uuid references profiles(id) on delete set null,
  note text,
  recorded_at timestamptz not null default now()
);

create index payments_received_user_id_idx on payments_received(user_id);

alter table payments_received enable row level security;

create policy "Users read own payments_received"
  on payments_received for select
  using (user_id = auth.uid());

create policy "Admins read all payments_received"
  on payments_received for select
  using (get_user_role() = 'admin');

create policy "Admins manage payments_received"
  on payments_received for all
  using (get_user_role() = 'admin');

-- ============================================================
-- BLOCKING: factor in manual block
-- ============================================================

create or replace function is_user_booking_blocked(p_user_id uuid)
returns boolean
language sql
security definer
stable
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
        (select late_cancel_unblocked_until from profiles where id = p_user_id)
        is null
        or (select late_cancel_unblocked_until from profiles where id = p_user_id)
           < date_trunc('month', now())::date
      )
    );
$$;

-- ============================================================
-- OWED AMOUNT
-- ============================================================

-- Sum of pence currently owed by a user
create or replace function get_user_owed_amount(p_user_id uuid)
returns integer
language sql
security definer
stable
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
  paid_back as (
    select coalesce(sum(amount), 0)::bigint as total
    from payments_received
    where user_id = p_user_id
  )
  select greatest(
    (select total from class_owed)
    + (select total from oto_owed)
    - (select total from paid_back),
    0
  )::integer;
$$;

-- Per-session breakdown of unconfirmed cash sessions (admin or self)
create or replace function get_user_owed_breakdown(p_user_id uuid)
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

  order by session_date desc;
end;
$$;

-- History of admin-recorded paybacks (admin or self)
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
as $$
begin
  if auth.uid() != p_user_id and get_user_role() != 'admin' then
    return;
  end if;

  return query
  select
    pr.id,
    pr.amount,
    pr.note,
    rb.full_name as recorded_by_name,
    pr.recorded_at
  from payments_received pr
  left join profiles rb on rb.id = pr.recorded_by
  where pr.user_id = p_user_id
  order by pr.recorded_at desc;
end;
$$;

-- ============================================================
-- ADMIN USERS LIST: extend with owed amount + manual block flag
-- ============================================================

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
