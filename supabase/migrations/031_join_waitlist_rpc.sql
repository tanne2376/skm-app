-- ============================================================
-- ATOMIC WAITLIST JOIN
-- ============================================================
-- Fixes a bug where two students joining the same waitlist both
-- received position 1.
--
-- Cause: the client computed waitlist_position by reading
-- max(waitlist_position) from the bookings table itself. The RLS
-- policy "Students read own bookings" (002_rls.sql:87) restricts
-- SELECT to the caller's own rows, so each joining student saw an
-- empty waitlist and computed 0 + 1 = 1.
--
-- Fix: SECURITY DEFINER RPC that bypasses RLS for the position
-- read, serializes concurrent joiners on a per-session advisory
-- lock, then inserts the booking. Returns the new position so the
-- caller can display it immediately.
-- ============================================================

create or replace function join_session_waitlist(
  p_session_id uuid,
  p_payment_method payment_method_type
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

  insert into bookings (
    session_id,
    student_id,
    status,
    payment_method,
    payment_status,
    waitlist_position
  ) values (
    p_session_id,
    v_student_id,
    'waitlisted',
    p_payment_method,
    'pending',
    v_next_position
  );

  return v_next_position;

exception
  when unique_violation then
    -- bookings has unique(session_id, student_id) — student already
    -- has a confirmed or waitlisted booking on this session.
    raise exception 'You already have a booking for this class.'
      using errcode = '23505';
end;
$$;

revoke execute on function join_session_waitlist(uuid, payment_method_type) from public;
revoke execute on function join_session_waitlist(uuid, payment_method_type) from anon;
grant  execute on function join_session_waitlist(uuid, payment_method_type) to authenticated;
