-- ============================================================
-- AUTO-CREATE PROFILE ON SIGN UP
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

-- Get effective capacity for a session (override or template)
create or replace function get_session_capacity(p_session_id uuid)
returns smallint
language sql
stable
as $$
  select coalesce(s.capacity, t.capacity)::smallint
  from class_sessions s
  join class_templates t on t.id = s.template_id
  where s.id = p_session_id
$$;

-- Get effective price for a session (override or template)
create or replace function get_session_price(p_session_id uuid)
returns integer
language sql
stable
as $$
  select coalesce(s.price, t.price)
  from class_sessions s
  join class_templates t on t.id = s.template_id
  where s.id = p_session_id
$$;

-- Get confirmed booking count for a session
create or replace function get_session_booking_count(p_session_id uuid)
returns bigint
language sql
stable
as $$
  select count(*)
  from bookings
  where session_id = p_session_id
    and status = 'confirmed'
$$;

-- Get waitlist count for a session
create or replace function get_session_waitlist_count(p_session_id uuid)
returns bigint
language sql
stable
as $$
  select count(*)
  from bookings
  where session_id = p_session_id
    and status = 'waitlisted'
$$;

-- Return the Monday (ISODOW=1) of the ISO week containing the given date
create or replace function iso_week_start(p_date date)
returns date
language sql
immutable
as $$
  select (date_trunc('week', p_date::timestamp))::date
$$;

-- Decrement waitlist positions for all waitlisted bookings above a given position
create or replace function decrement_waitlist_positions(
  p_session_id uuid,
  p_min_position smallint
)
returns void
language sql
as $$
  update bookings
  set waitlist_position = waitlist_position - 1
  where session_id = p_session_id
    and status = 'waitlisted'
    and waitlist_position > p_min_position;
$$;
