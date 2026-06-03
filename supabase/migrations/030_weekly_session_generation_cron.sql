-- ============================================================
-- WEEKLY SESSION GENERATION CRON
-- ============================================================
-- generate_sessions_ahead(4) creates session rows for the next 4 ISO
-- weeks from the existing class_templates. Without a recurring trigger
-- the table runs dry and the home page shows "no upcoming sessions".
-- This was on the launch checklist but never actioned.
--
-- NOTE: this migration was originally applied directly to the remote
-- (recorded as version 20260507213945 enable_pg_cron_session_generation)
-- and had no repo file. It is captured here so the repo is the full
-- source of truth for a rebuild. Idempotent — safe to re-run.
-- ============================================================

create extension if not exists pg_cron with schema extensions;

-- Idempotent: drop any prior job with the same name before scheduling.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-generate-sessions') then
    perform cron.unschedule('weekly-generate-sessions');
  end if;
end $$;

select cron.schedule(
  'weekly-generate-sessions',
  '0 0 * * 1',                          -- Mondays at 00:00 UTC
  $cron$ select generate_sessions_ahead(4); $cron$
);
