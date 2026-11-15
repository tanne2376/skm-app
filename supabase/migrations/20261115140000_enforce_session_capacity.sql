-- Enforce class capacity when a confirmed booking is inserted.
--
-- Callers checked capacity before inserting, but nothing stopped two
-- checkouts for the last place from both inserting (book-with-membership
-- didn't check at all). A per-session advisory lock serialises confirmed
-- inserts for a session; the count runs after the lock, so it sees any
-- booking committed by the transaction that held it.
--
-- Only INSERTs: waitlist promotions/claims (UPDATE waitlisted → confirmed)
-- happen when a place frees up and are serialised by their own RPCs.

create or replace function enforce_session_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_confirmed integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('booking_capacity:' || new.session_id::text, 0));

  select coalesce(s.capacity, t.capacity)
    into v_capacity
  from class_sessions s
  join class_templates t on t.id = s.template_id
  where s.id = new.session_id;

  if v_capacity is null then
    return new;
  end if;

  select count(*)
    into v_confirmed
  from bookings
  where session_id = new.session_id
    and status = 'confirmed';

  if v_confirmed >= v_capacity then
    raise exception 'This class is full.'
      using errcode = 'P0001', hint = 'class_full';
  end if;

  return new;
end;
$$;

revoke execute on function enforce_session_capacity() from public, anon, authenticated;

-- Named to sort after bookings_validate, so waiver/kids errors win.
create trigger bookings_validate_capacity
  before insert on bookings
  for each row
  when (new.status = 'confirmed')
  execute function enforce_session_capacity();
