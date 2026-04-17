-- ============================================================
-- LATE CANCELLATION TRACKING
-- ============================================================

-- Track every late cancellation (≤3hrs before class)
create table late_cancellations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  booking_id uuid not null references bookings(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  session_start_time timestamptz not null,
  cancelled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_late_cancellations_user_month
  on late_cancellations (user_id, cancelled_at);

-- Admin override: unblock a user for the current month
-- When set, late cancellations still count but the block is lifted
alter table profiles add column late_cancel_unblocked_until date;

-- RLS
alter table late_cancellations enable row level security;

create policy "Users read own late cancellations"
  on late_cancellations for select
  using (user_id = auth.uid());

create policy "Admins read all late cancellations"
  on late_cancellations for select
  using (get_user_role() = 'admin');

create policy "Admins manage late cancellations"
  on late_cancellations for all
  using (get_user_role() = 'admin');

-- RPC: count late cancellations for a user in the current calendar month
create or replace function get_late_cancellation_count(p_user_id uuid)
returns integer
language sql
security definer
stable
as $$
  select count(*)::integer
  from late_cancellations
  where user_id = p_user_id
    and cancelled_at >= date_trunc('month', now())
    and cancelled_at < date_trunc('month', now()) + interval '1 month';
$$;

-- RPC: check if a user is blocked from booking classes
-- Returns true if blocked (≥3 late cancels this month AND no admin override)
create or replace function is_user_booking_blocked(p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
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
    );
$$;

-- RPC: admin view — get all users with their late cancellation count and membership info
create or replace function get_users_with_late_cancellations()
returns table (
  user_id uuid,
  full_name text,
  role text,
  late_cancellation_count integer,
  membership_tier text,
  membership_status text,
  is_blocked boolean,
  late_cancel_unblocked_until date
)
language sql
security definer
stable
as $$
  select
    p.id as user_id,
    p.full_name,
    p.role::text,
    coalesce(lc.cnt, 0)::integer as late_cancellation_count,
    m.tier::text as membership_tier,
    m.status::text as membership_status,
    (
      coalesce(lc.cnt, 0) >= 3
      and (
        p.late_cancel_unblocked_until is null
        or p.late_cancel_unblocked_until < date_trunc('month', now())::date
      )
    ) as is_blocked,
    p.late_cancel_unblocked_until
  from profiles p
  left join lateral (
    select count(*)::integer as cnt
    from late_cancellations
    where user_id = p.id
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
  order by coalesce(lc.cnt, 0) desc, p.full_name asc;
$$;

-- RPC: get late cancellation history for a specific user
create or replace function get_user_late_cancellation_history(p_user_id uuid)
returns table (
  id uuid,
  session_id uuid,
  class_name text,
  session_date date,
  session_start_time text,
  cancelled_at timestamptz
)
language sql
security definer
stable
as $$
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
$$;
