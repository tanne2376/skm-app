-- ============================================================
-- ONE-TO-ONE: updated visibility rules + past session cleanup
-- ============================================================

-- Drop old one_to_one RLS policies
drop policy if exists "Students see available and own one_to_ones" on one_to_ones;
drop policy if exists "Teachers see their own one_to_ones" on one_to_ones;
drop policy if exists "Teachers manage their one_to_ones" on one_to_ones;
drop policy if exists "Admins manage all one_to_ones" on one_to_ones;
drop policy if exists "Students book available one_to_ones" on one_to_ones;

-- ── SELECT ──────────────────────────────────────────────────
-- Everyone sees available sessions that are NOT their own
create policy "See available one_to_ones from others"
  on one_to_ones for select
  using (status = 'available' and creator_id != auth.uid());

-- Creators / teachers see all their own sessions (any status)
create policy "Creators see own one_to_ones"
  on one_to_ones for select
  using (creator_id = auth.uid() or teacher_id = auth.uid());

-- Students see sessions they booked
create policy "Students see booked one_to_ones"
  on one_to_ones for select
  using (student_id = auth.uid());

-- ── INSERT ──────────────────────────────────────────────────
-- Teachers and admins can create one-to-ones
create policy "Teachers and admins create one_to_ones"
  on one_to_ones for insert
  with check (
    get_user_role() in ('teacher', 'admin')
    and creator_id = auth.uid()
  );

-- ── UPDATE ──────────────────────────────────────────────────
-- Creators / teachers update their own sessions
create policy "Creators update own one_to_ones"
  on one_to_ones for update
  using (creator_id = auth.uid() or teacher_id = auth.uid());

-- Students can book available one-to-ones (available → booked)
create policy "Students book available one_to_ones"
  on one_to_ones for update
  using (status = 'available')
  with check (student_id = auth.uid() and status = 'booked');

-- ── DELETE ──────────────────────────────────────────────────
-- Creators can delete their own sessions
create policy "Creators delete own one_to_ones"
  on one_to_ones for delete
  using (creator_id = auth.uid() or teacher_id = auth.uid());

-- ============================================================
-- Function to delete past one-to-one sessions
-- Call via cron or manually: select delete_past_one_to_ones();
-- ============================================================
create or replace function delete_past_one_to_ones()
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from one_to_ones
  where (session_date + start_time) < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
