-- ============================================================
-- ACCOUNT DELETION SUPPORT (Apple guideline 5.1.1(v))
-- ============================================================
-- Apple requires apps with account creation to offer in-app
-- account deletion. Because bookings/memberships/blocks FK to
-- profiles with ON DELETE RESTRICT (financial history must
-- survive), we cannot hard-delete the profile row. Instead the
-- delete-account Edge Function:
--   1. cancels active Stripe subscriptions
--   2. calls anonymize_profile_for_deletion (this RPC) as the
--      service-role to scrub PII and release future bookings
--   3. deletes the auth.users row (cascades to push tokens etc.)
--
-- Apple accepts this pattern when historic records must be
-- retained for legal/accounting reasons, provided the privacy
-- policy discloses it.
-- ============================================================

alter table profiles
  add column if not exists deleted_at timestamptz;

create index if not exists profiles_deleted_at_idx
  on profiles(deleted_at) where deleted_at is not null;

-- ------------------------------------------------------------
-- Break the cascade from auth.users → profiles.
--
-- profiles originally had `references auth.users(id) on delete
-- cascade`, but bookings/memberships/blocks reference profiles
-- with ON DELETE RESTRICT to preserve financial history.
-- Cascading the auth.users delete therefore fails for any user
-- with history. Drop the FK so account deletion can delete the
-- auth.users row while leaving the anonymised profile in place.
-- The profile is identified by its id and no longer needs FK
-- enforcement back to auth.users.
-- ------------------------------------------------------------

do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
    from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and contype = 'f'
     and confrelid = 'auth.users'::regclass;
  if v_constraint_name is not null then
    execute format('alter table profiles drop constraint %I', v_constraint_name);
  end if;
end $$;

-- ------------------------------------------------------------
-- anonymize_profile_for_deletion
--
-- Run by the delete-account Edge Function under the service
-- role. Anonymises PII, tombstones the profile, frees up future
-- class capacity, and releases future 1-to-1 slots.
--
-- Stripe customer id is intentionally retained: refund and
-- accounting workflows need to reach the historic charges.
-- ------------------------------------------------------------

create or replace function anonymize_profile_for_deletion(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;

  update bookings b
    set status = 'cancelled',
        cancelled_at = coalesce(b.cancelled_at, now())
    from class_sessions cs
   where b.session_id = cs.id
     and b.student_id = p_user_id
     and b.status in ('confirmed', 'waitlisted')
     and cs.session_date >= current_date;

  update one_to_ones
     set student_id = null,
         status = 'available',
         payment_method = null,
         payment_status = null,
         stripe_payment_intent_id = null
   where student_id = p_user_id
     and session_date >= current_date
     and status = 'booked';

  update profiles
     set full_name = 'Deleted user',
         phone = null,
         push_token = null,
         deleted_at = coalesce(deleted_at, now())
   where id = p_user_id;
end;
$$;

revoke execute on function anonymize_profile_for_deletion(uuid)
  from anon, authenticated, public;
