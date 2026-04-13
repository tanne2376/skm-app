-- Track burned membership slots (late cancellations ≤3hrs).
-- A burned row still counts toward the 2/week quota but the session is cancelled.
ALTER TABLE membership_weekly_usage ADD COLUMN is_burned boolean NOT NULL DEFAULT false;
