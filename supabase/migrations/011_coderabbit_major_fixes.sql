-- ============================================================
-- 1. Unique constraint on membership_weekly_usage
--    Prevents the same booking being counted twice for a membership
-- ============================================================

-- Remove any existing duplicates before adding constraint
DELETE FROM membership_weekly_usage a
USING membership_weekly_usage b
WHERE a.id < b.id
  AND a.membership_id = b.membership_id
  AND a.booking_id = b.booking_id;

alter table membership_weekly_usage
  add constraint membership_weekly_usage_membership_booking_key
  unique (membership_id, booking_id);

-- ============================================================
-- 2. Restrict one_to_ones booking RLS policy
--    Old policy let students update ANY column (e.g. price, teacher_id).
--    New policy uses a check function to ensure only student_id, status,
--    payment_method, and payment_status can change during booking.
-- ============================================================

drop policy if exists "Students book available one_to_ones" on one_to_ones;

create or replace function check_student_book_one_to_one()
returns trigger as $$
begin
  -- Only allow changes to booking-related columns
  if NEW.teacher_id    is distinct from OLD.teacher_id
  or NEW.creator_id    is distinct from OLD.creator_id
  or NEW.title         is distinct from OLD.title
  or NEW.description   is distinct from OLD.description
  or NEW.price         is distinct from OLD.price
  or NEW.session_date  is distinct from OLD.session_date
  or NEW.start_time    is distinct from OLD.start_time
  or NEW.end_time      is distinct from OLD.end_time
  or NEW.location_type is distinct from OLD.location_type
  or NEW.location_id   is distinct from OLD.location_id
  or NEW.location_text is distinct from OLD.location_text
  then
    raise exception 'Only booking fields can be modified when booking a one-to-one';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_student_book_one_to_one
  before update on one_to_ones
  for each row
  when (OLD.status = 'available' and NEW.status = 'booked')
  execute function check_student_book_one_to_one();

-- Re-create the RLS policy (same logic, trigger guards the columns)
create policy "Students book available one_to_ones"
  on one_to_ones for update
  using (status = 'available')
  with check (student_id = auth.uid() and status = 'booked');
