-- ============================================================
-- WAITLIST GAP BACKFILL
-- ============================================================
-- When a waitlisted booking leaves the queue (either cancels or
-- is confirmed via claim-waitlist-spot), everyone behind it
-- should move up so positions stay contiguous (1, 2, 3, ...).
--
-- Bugs this fixes:
--   * Cancelling a waitlist spot left a hole — students behind
--     the leaver kept their old position number forever.
--   * When the front-of-queue waitlister claimed a vacated class
--     spot, positions #2/#3/... never decremented to #1/#2/...
--
-- Cause: decrement_waitlist_positions (defined in 004_triggers
-- but never called) was the missing link.
--
-- Fix: AFTER UPDATE trigger on bookings that watches the status
-- column and rebalances positions in either direction:
--   * status leaves 'waitlisted'  → decrement positions > old
--   * status enters 'waitlisted'  → increment positions >= new
--     (handles the rollback path in claim-waitlist-spot, which
--     momentarily flips a row to 'confirmed' then back if a
--     downstream insert fails — without the inverse case, the
--     rollback would leave duplicate positions in the queue.)
--
-- SECURITY DEFINER so the rebalancing UPDATE can touch other
-- students' rows even when triggered from a context where RLS
-- would otherwise hide them.
-- ============================================================

create or replace function backfill_waitlist_positions_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Leaving the waitlist: close the gap.
  if old.status = 'waitlisted'
     and new.status is distinct from 'waitlisted'
     and old.waitlist_position is not null then
    update bookings
    set waitlist_position = waitlist_position - 1
    where session_id = old.session_id
      and status = 'waitlisted'
      and waitlist_position > old.waitlist_position;

  -- Returning to the waitlist (e.g. claim rollback): re-open the
  -- gap so the restored row doesn't collide with the position
  -- that's been backfilled into its slot.
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

  return null; -- AFTER trigger — return value is ignored
end;
$$;

drop trigger if exists backfill_waitlist_positions on bookings;

create trigger backfill_waitlist_positions
  after update of status on bookings
  for each row
  when (old.status is distinct from new.status)
  execute function backfill_waitlist_positions_on_status_change();

-- Lock down: SECURITY DEFINER functions get EXECUTE granted to
-- PUBLIC by default. The trigger fires automatically — no client
-- should ever call this directly.
revoke execute on function backfill_waitlist_positions_on_status_change() from public;
revoke execute on function backfill_waitlist_positions_on_status_change() from anon;
revoke execute on function backfill_waitlist_positions_on_status_change() from authenticated;
