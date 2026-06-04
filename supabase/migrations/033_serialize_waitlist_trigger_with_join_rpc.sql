-- ============================================================
-- SERIALIZE WAITLIST TRIGGER AGAINST JOIN_SESSION_WAITLIST
-- ============================================================
-- The 032 trigger and the 031 join RPC each touch
-- bookings.waitlist_position for a session, but only the RPC
-- held the per-session advisory lock. Under concurrent
-- join+cancel, the trigger's decrement could miss an in-flight
-- INSERT (or vice versa), leaving a gap.
--
-- Sequence that produced the gap:
--   state: A=1, B=2, C=3
--   T1 (join) reads max(position) = 3, plans insert at 4
--   T2 (cancel B) trigger fires, decrements C from 3 to 2
--   T2 commits
--   T1 inserts at 4
--   final: A=1, C=2, new=4  ← gap at 3
--
-- Fix: have the trigger acquire the same advisory lock that
-- join_session_waitlist uses. Both paths now serialize per
-- session, so the trigger's decrement and the RPC's max-read
-- can't interleave.
--
-- Lock key must match 031 exactly:
--   hashtextextended('join_session_waitlist:' || session_id, 0)
-- ============================================================

create or replace function backfill_waitlist_positions_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Match the lock taken by join_session_waitlist so concurrent
  -- joins and status transitions on the same session serialize.
  perform pg_advisory_xact_lock(
    hashtextextended('join_session_waitlist:' || old.session_id::text, 0)
  );

  -- Leaving the waitlist: close the gap.
  if old.status = 'waitlisted'
     and new.status is distinct from 'waitlisted'
     and old.waitlist_position is not null then
    update bookings
    set waitlist_position = waitlist_position - 1
    where session_id = old.session_id
      and status = 'waitlisted'
      and waitlist_position > old.waitlist_position;

  -- Returning to the waitlist (e.g. claim rollback): re-open
  -- the gap so the restored row doesn't collide.
  elsif new.status = 'waitlisted'
        and old.status is distinct from 'waitlisted'
        and new.waitlist_position is not null then
    update bookings
    set waitlist_position = waitlist_position + 1
    where session_id = new.session_id
      and status = 'waitlisted'
      and id <> new.id
      and waitlist_position >= new.waitlist_position;
  end if;

  return null;
end;
$$;
