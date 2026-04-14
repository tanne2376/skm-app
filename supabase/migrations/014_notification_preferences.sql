-- Add notification preferences JSONB column to profiles.
-- Each key is a notification type; value is boolean (enabled/disabled).
-- Missing keys are treated as enabled (opt-out model).

alter table profiles
  add column notification_preferences jsonb not null default '{}'::jsonb;

alter table profiles
  add constraint profiles_notification_preferences_is_object
  check (jsonb_typeof(notification_preferences) = 'object');

comment on column profiles.notification_preferences is
  'Per-user notification opt-outs. Keys: waitlist_promotion, one_to_one_available, upcoming_class, class_joined, class_left, one_to_one_booked, class_full, class_time_changed, membership_renewal. Missing key = enabled.';
