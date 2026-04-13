-- Replace the absolute unique constraint on (session_id, student_id) with a
-- partial unique index that only applies to non-cancelled bookings.
-- This allows a student to rebook a class after cancelling their original booking.

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_session_id_student_id_key;

CREATE UNIQUE INDEX bookings_session_student_active_idx
  ON bookings (session_id, student_id)
  WHERE status <> 'cancelled';
