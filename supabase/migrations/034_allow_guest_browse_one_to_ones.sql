-- ============================================================
-- Allow unauthenticated guests to browse available 1-to-1s
-- ============================================================
-- The original policy used `creator_id <> auth.uid()`, which for an
-- anonymous request (auth.uid() IS NULL) returns NULL rather than TRUE,
-- so RLS hid every row from guests. `IS DISTINCT FROM` treats NULL as
-- a value, so the comparison evaluates correctly in both cases:
--   - authenticated user: still hides their own (X is distinct from X = false)
--   - guest: sees all available rows (X is distinct from null = true)
-- Needed to comply with Apple guideline 5.1.1 (no login wall on browse).

drop policy if exists "See available one_to_ones from others" on one_to_ones;

create policy "See available one_to_ones from others"
  on one_to_ones for select
  using (
    status = 'available'
    and (creator_id is distinct from auth.uid())
  );
