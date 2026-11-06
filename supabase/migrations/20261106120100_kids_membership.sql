-- Kids membership and child bookings.
--
-- A kids membership (£40/mo) belongs to one child on a parent's account and
-- covers unlimited kids classes. It is the only way into a kids class: no
-- pay-per-class, no cash per class. Adult memberships don't cover kids
-- classes and kids memberships don't cover anything else.
--
-- Bookings for a child carry child_id; student_id stays the parent (who pays,
-- cancels and is notified). Adult bookings keep child_id null.

-- ============================================================
-- memberships.child_id
-- ============================================================

-- Default NO ACTION, like waivers.child_id: a child with a membership can't be
-- removed, but a cascading profile delete still clears both.
alter table memberships add column child_id uuid references children(id);
create index memberships_child_id_idx on memberships(child_id) where child_id is not null;

alter table memberships add constraint memberships_kids_child_link
  check ((tier = 'kids') = (child_id is not null));

-- One adult membership per account, plus one kids membership per child.
drop index memberships_one_active_per_student;
create unique index memberships_one_active_adult_per_student
  on memberships (student_id)
  where child_id is null and status in ('active', 'cancelling', 'past_due');
create unique index memberships_one_active_per_child
  on memberships (child_id)
  where child_id is not null and status in ('active', 'cancelling', 'past_due');

-- Mirrors MEMBERSHIP_PRICES_PENCE in constants/index.ts.
create or replace function membership_tier_price_pence(p_tier membership_tier)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'two_per_week' then 8000
    when 'unlimited' then 10000
    when 'kids' then 4000
  end;
$$;

-- ============================================================
-- bookings.child_id
-- ============================================================

alter table bookings add column child_id uuid references children(id);
create index bookings_child_id_idx on bookings(child_id) where child_id is not null;

-- A parent can't be booked twice into a class, nor can the same child; but a
-- parent can book several of their children into the same kids class.
drop index bookings_session_student_active_idx;
create unique index bookings_session_student_active_idx
  on bookings (session_id, student_id)
  where status <> 'cancelled' and child_id is null;
create unique index bookings_session_child_active_idx
  on bookings (session_id, child_id)
  where status <> 'cancelled' and child_id is not null;

-- ============================================================
-- Booking rules (replaces bookings_require_adult_waiver)
-- ============================================================

-- Kids classes take only child bookings paid by that child's kids membership;
-- every other class takes only adult bookings. The participant needs a signed
-- waiver: the account holder's own for an adult booking, the child's for a
-- child booking.
--
-- Fires for every path that books: direct cash inserts, the waitlist RPC, the
-- service-role edge functions, and students' own updates (RLS lets them
-- update their rows). Cancelling is always allowed.
create or replace function validate_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level class_level;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  select t.level into v_level
  from class_sessions s
  join class_templates t on t.id = s.template_id
  where s.id = new.session_id;

  if new.child_id is null then
    -- Updates that keep the same person and class (claims, payment changes)
    -- were checked when the row was made.
    if tg_op = 'UPDATE'
       and old.child_id is null
       and new.session_id = old.session_id
       and new.student_id = old.student_id then
      return new;
    end if;

    if v_level = 'kids' then
      raise exception 'Kids classes are booked for a child on your account, with a kids membership.'
        using errcode = 'P0001', hint = 'kids_membership_required';
    end if;
    if not exists (
      select 1 from waivers where user_id = new.student_id and child_id is null
    ) then
      raise exception 'Please sign your waiver before booking.'
        using errcode = 'P0001', hint = 'waiver_required';
    end if;
    return new;
  end if;

  if v_level is distinct from 'kids' then
    raise exception 'Children can only be booked into kids classes.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from children where id = new.child_id and parent_id = new.student_id
  ) then
    raise exception 'Child not found on this account.' using errcode = '42501';
  end if;
  if not exists (select 1 from waivers where child_id = new.child_id) then
    raise exception 'Please sign this child’s waiver before booking.'
      using errcode = 'P0001', hint = 'waiver_required';
  end if;
  if new.payment_method <> 'membership' or not exists (
    select 1
    from memberships m
    where m.child_id = new.child_id
      and m.tier = 'kids'
      and m.status in ('active', 'cancelling')
      and not membership_cash_grace_expired(m.id)
  ) then
    raise exception 'Kids classes need an active kids membership for this child.'
      using errcode = 'P0001', hint = 'kids_membership_required';
  end if;
  return new;
end;
$$;

revoke execute on function validate_booking() from public, anon, authenticated;

drop trigger bookings_require_adult_waiver on bookings;

create trigger bookings_validate
  before insert or update of session_id, student_id, child_id, payment_method, status on bookings
  for each row execute function validate_booking();

-- ============================================================
-- Cash memberships: adult or kids
-- ============================================================

drop function create_cash_membership(membership_tier);

-- p_child_id is required for the kids tier and must be null otherwise.
-- Activates immediately, period anchored to the start of the current month
-- (matching the Stripe subscription anchor).
create or replace function create_cash_membership(p_tier membership_tier, p_child_id uuid default null)
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
  v_already text := case when p_child_id is null
    then 'You already have an active membership.'
    else 'This child already has an active kids membership.' end;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
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
$$;

revoke execute on function create_cash_membership(membership_tier, uuid) from public, anon;
grant execute on function create_cash_membership(membership_tier, uuid) to authenticated;

-- ============================================================
-- Waitlist: optionally for a child
-- ============================================================

drop function join_session_waitlist(uuid, payment_method_type);

create or replace function join_session_waitlist(
  p_session_id uuid,
  p_payment_method payment_method_type,
  p_child_id uuid default null
)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid := auth.uid();
  v_next_position smallint;
begin
  if v_student_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  -- Per-session advisory lock so two transactions can't read the
  -- same max(waitlist_position) and both insert position N+1.
  -- Auto-released at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('join_session_waitlist:' || p_session_id::text, 0)
  );

  select coalesce(max(waitlist_position), 0)::smallint + 1
    into v_next_position
  from bookings
  where session_id = p_session_id
    and status = 'waitlisted';

  -- validate_booking checks the child, waiver and kids membership.
  insert into bookings (
    session_id,
    student_id,
    child_id,
    status,
    payment_method,
    payment_status,
    waitlist_position
  ) values (
    p_session_id,
    v_student_id,
    p_child_id,
    'waitlisted',
    p_payment_method,
    'pending',
    v_next_position
  );

  return v_next_position;

exception
  when unique_violation then
    -- This person already has a confirmed or waitlisted booking here.
    raise exception '%', case when p_child_id is null
        then 'You already have a booking for this class.'
        else 'This child already has a booking for this class.' end
      using errcode = '23505';
end;
$$;

revoke execute on function join_session_waitlist(uuid, payment_method_type, uuid) from public, anon;
grant execute on function join_session_waitlist(uuid, payment_method_type, uuid) to authenticated;

-- ============================================================
-- Roster: child's name, parent as guardian, matching membership
-- ============================================================

create or replace function get_class_roster(p_session_id uuid)
returns table (
  booking_id uuid,
  student_id uuid,
  student_name text,
  guardian_name text,
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
  if v_role is null or v_role not in ('teacher', 'admin') then
    raise exception 'Only teachers and admins can view class rosters.';
  end if;

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
    coalesce(c.full_name, p.full_name)                                     as student_name,
    case when b.child_id is not null then p.full_name end                  as guardian_name,
    b.booked_at,
    b.payment_method::text                                                 as payment_method,
    b.payment_status::text                                                 as payment_status,
    m.id                                                                   as membership_id,
    m.tier::text                                                           as membership_tier,
    m.payment_method::text                                                 as membership_payment_method,
    m.payment_status::text                                                 as membership_payment_status,
    case
      when b.payment_method = 'membership' then membership_tier_price_pence(m.tier)
      when b.payment_method = 'cash'       then (select price from class_price)
      else null
    end                                                                    as follow_up_amount_pence,
    case
      when b.payment_method = 'cash' and b.payment_status = 'pending'                                         then true
      when b.payment_method = 'membership' and m.payment_method = 'cash' and m.payment_status = 'pending'     then true
      else false
    end                                                                    as cash_pending
  from bookings b
  join profiles p on p.id = b.student_id
  left join children c on c.id = b.child_id
  left join lateral (
    select *
    from memberships mi
    where mi.student_id = b.student_id
      and mi.child_id is not distinct from b.child_id
      and mi.status in ('active', 'cancelling')
    order by mi.created_at desc
    limit 1
  ) m on b.payment_method = 'membership'
  where b.session_id = p_session_id
    and b.status = 'confirmed'
  order by b.booked_at asc;
end;
$$;

-- ============================================================
-- Cash breakdown: name the child on a kids membership
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
stable
security definer
set search_path = public
as $$
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
      when 'kids' then 'Kids membership — ' || coalesce(c.full_name, 'child')
    end as description,
    m.created_at::date as session_date,
    membership_tier_price_pence(m.tier) as amount
  from memberships m
  left join children c on c.id = m.child_id
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

-- ============================================================
-- Admin users list: the account holder's own membership
-- ============================================================

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
stable
security definer
set search_path = public
as $$
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
      and child_id is null
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
$$;
