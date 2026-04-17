-- Prevent duplicate late-cancellation strikes for the same booking
-- (e.g. from retries or race conditions)
alter table late_cancellations
  add constraint late_cancellations_booking_id_unique unique (booking_id);
