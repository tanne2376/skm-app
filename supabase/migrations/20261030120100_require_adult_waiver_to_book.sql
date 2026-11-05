-- Booking for the account holder requires their own (adult) waiver.
--
-- Apply only together with the app release that includes waivers: older
-- builds never ask users to sign, so this would block every booking for
-- accounts without a waiver.

-- Covers every path that books for the account holder: direct cash inserts,
-- the waitlist RPC, and the service-role edge functions (Stripe, membership,
-- 1-to-1 cash/app/block), since triggers fire regardless of role.
create or replace function require_adult_waiver()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from waivers where user_id = new.student_id and child_id is null
  ) then
    raise exception 'Please sign your waiver before booking.'
      using errcode = 'P0001', hint = 'waiver_required';
  end if;
  return new;
end;
$$;

revoke execute on function require_adult_waiver() from public, anon, authenticated;

create trigger bookings_require_adult_waiver
  before insert on bookings
  for each row execute function require_adult_waiver();

create trigger one_to_ones_require_adult_waiver
  before update of student_id on one_to_ones
  for each row
  when (old.student_id is null and new.student_id is not null)
  execute function require_adult_waiver();

