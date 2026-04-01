-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table class_templates enable row level security;
alter table class_sessions enable row level security;
alter table bookings enable row level security;
alter table memberships enable row level security;
alter table membership_weekly_usage enable row level security;
alter table one_to_ones enable row level security;
alter table locations enable row level security;

-- Helper: avoids per-row subquery overhead in policies
create or replace function get_user_role()
returns user_role
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid()
$$;

-- ============================================================
-- PROFILES
-- ============================================================

create policy "Users read own profile"
  on profiles for select
  using (id = auth.uid());

-- Prevents self-role-promotion
create policy "Users update own profile (non-role fields)"
  on profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from profiles where id = auth.uid())
  );

create policy "Admins read all profiles"
  on profiles for select
  using (get_user_role() = 'admin');

create policy "Admins update all profiles"
  on profiles for update
  using (get_user_role() = 'admin');

-- Profile row is created by the trigger (runs as service role)
create policy "Service role insert profiles"
  on profiles for insert
  with check (true);

-- ============================================================
-- CLASS TEMPLATES
-- ============================================================

create policy "Anyone read active templates"
  on class_templates for select
  using (is_active = true or get_user_role() in ('teacher', 'admin'));

create policy "Admins manage templates"
  on class_templates for all
  using (get_user_role() = 'admin');

-- ============================================================
-- CLASS SESSIONS
-- ============================================================

create policy "Anyone read sessions"
  on class_sessions for select
  using (true);

create policy "Admins manage sessions"
  on class_sessions for all
  using (get_user_role() = 'admin');

create policy "Teachers update their sessions"
  on class_sessions for update
  using (teacher_id = auth.uid() and get_user_role() = 'teacher')
  with check (teacher_id = auth.uid());

-- ============================================================
-- BOOKINGS
-- ============================================================

create policy "Students read own bookings"
  on bookings for select
  using (student_id = auth.uid());

create policy "Students insert own bookings"
  on bookings for insert
  with check (student_id = auth.uid());

create policy "Students update own bookings"
  on bookings for update
  using (student_id = auth.uid());

create policy "Teachers read bookings for their sessions"
  on bookings for select
  using (
    get_user_role() = 'teacher'
    and exists (
      select 1 from class_sessions
      where class_sessions.id = bookings.session_id
      and class_sessions.teacher_id = auth.uid()
    )
  );

create policy "Teachers confirm cash payment for their sessions"
  on bookings for update
  using (
    get_user_role() = 'teacher'
    and exists (
      select 1 from class_sessions
      where class_sessions.id = bookings.session_id
      and class_sessions.teacher_id = auth.uid()
    )
  );

create policy "Admins manage all bookings"
  on bookings for all
  using (get_user_role() = 'admin');

-- ============================================================
-- MEMBERSHIPS
-- ============================================================

create policy "Students read own membership"
  on memberships for select
  using (student_id = auth.uid());

create policy "Admins manage memberships"
  on memberships for all
  using (get_user_role() = 'admin');

-- ============================================================
-- MEMBERSHIP WEEKLY USAGE
-- ============================================================

create policy "Students read own usage"
  on membership_weekly_usage for select
  using (student_id = auth.uid());

create policy "Admins read all usage"
  on membership_weekly_usage for select
  using (get_user_role() = 'admin');

-- ============================================================
-- ONE TO ONES
-- ============================================================

create policy "Students see available and own one_to_ones"
  on one_to_ones for select
  using (status = 'available' or student_id = auth.uid());

create policy "Teachers see their own one_to_ones"
  on one_to_ones for select
  using (teacher_id = auth.uid() or creator_id = auth.uid());

create policy "Teachers manage their one_to_ones"
  on one_to_ones for all
  using (teacher_id = auth.uid() or creator_id = auth.uid());

create policy "Admins manage all one_to_ones"
  on one_to_ones for all
  using (get_user_role() = 'admin');

-- ============================================================
-- LOCATIONS
-- ============================================================

create policy "Anyone read active locations"
  on locations for select
  using (is_active = true or get_user_role() = 'admin');

create policy "Admins manage locations"
  on locations for all
  using (get_user_role() = 'admin');
