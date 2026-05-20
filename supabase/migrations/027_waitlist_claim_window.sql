-- ============================================================
-- WAITLIST CLAIM WINDOW
-- ============================================================
-- Old behaviour: when a confirmed booking cancelled, the next person
-- on the waitlist was auto-promoted only if they had an active
-- membership OR a saved Stripe default_payment_method. Anyone without
-- either was silently stuck on the waitlist forever.
--
-- New behaviour: every waitlist promotion is manual. When a spot
-- opens, the front-of-queue waitlister gets a 1-hour "claim window"
-- (notification + UI button). If they don't claim before expiry, they
-- get rotated to the back of the queue and the next person gets the
-- offer. The auto-charge path is gone.
--
-- claim_window_started_at = null    → not currently offered a spot
-- claim_window_started_at = <ts>    → offer started at <ts>, active
--                                     until <ts> + 1 hour
-- ============================================================

alter table bookings
  add column if not exists claim_window_started_at timestamptz;

create index if not exists bookings_claim_window_started_at_idx
  on bookings(claim_window_started_at)
  where claim_window_started_at is not null;
