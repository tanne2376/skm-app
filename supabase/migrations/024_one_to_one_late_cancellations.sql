-- ============================================================
-- 1-to-1 LATE CANCELLATION TRACKING
-- Extend late_cancellations to record strikes from 1-to-1 sessions
-- cancelled inside the 24h window. Mirrors the class policy in
-- migrations 015/016/017 so the admin Users view shows a single
-- combined count.
-- ============================================================

-- Source columns become optional — a row now records either a class
-- booking cancellation OR a 1-to-1 cancellation, never both.
alter table late_cancellations
  alter column booking_id drop not null,
  alter column session_id drop not null;

alter table late_cancellations
  add column one_to_one_id uuid references one_to_ones(id) on delete cascade;

-- Exactly one source: a class booking (booking_id + session_id) or a 1-to-1.
alter table late_cancellations
  add constraint late_cancellations_source_check check (
    (booking_id is not null and session_id is not null and one_to_one_id is null)
    or
    (booking_id is null and session_id is null and one_to_one_id is not null)
  );

-- Replace the constraint added in 016 with a partial unique index, and add
-- the equivalent for one_to_one_id. Postgres unique constraints permit
-- multiple NULLs, so the old constraint still worked for class rows, but
-- partial indexes make the intent (one strike per source row, ignore the
-- other column's NULLs) explicit.
alter table late_cancellations
  drop constraint if exists late_cancellations_booking_id_unique;

create unique index late_cancellations_booking_id_key
  on late_cancellations (booking_id)
  where booking_id is not null;

create unique index late_cancellations_one_to_one_id_key
  on late_cancellations (one_to_one_id)
  where one_to_one_id is not null;

-- ============================================================
-- HISTORY RPC: include 1-to-1 strikes
-- ============================================================
-- The return signature gains a `kind` column ('class' | 'one_to_one') so
-- the admin UI can label rows if needed. session_id, class_name,
-- session_date, session_start_time are filled from the corresponding
-- source row.
drop function if exists get_user_late_cancellation_history(uuid);

create or replace function get_user_late_cancellation_history(p_user_id uuid)
returns table (
  id uuid,
  kind text,
  session_id uuid,
  class_name text,
  session_date date,
  session_start_time text,
  cancelled_at timestamptz
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
    lc.id,
    'class'::text as kind,
    lc.session_id,
    ct.name as class_name,
    cs.session_date,
    cs.start_time::text as session_start_time,
    lc.cancelled_at
  from late_cancellations lc
  join class_sessions cs on cs.id = lc.session_id
  join class_templates ct on ct.id = cs.template_id
  where lc.user_id = p_user_id
    and lc.booking_id is not null
  union all
  select
    lc.id,
    'one_to_one'::text as kind,
    lc.one_to_one_id as session_id,
    oto.title as class_name,
    oto.session_date,
    oto.start_time::text as session_start_time,
    lc.cancelled_at
  from late_cancellations lc
  join one_to_ones oto on oto.id = lc.one_to_one_id
  where lc.user_id = p_user_id
    and lc.one_to_one_id is not null
  order by cancelled_at desc;
end;
$$;
