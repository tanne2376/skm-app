-- ============================================================
-- LAZY SESSION GENERATION
-- Generates class_sessions rows for upcoming weeks from active templates.
-- Called weekly by a scheduled Edge Function (generate-sessions).
-- Uses ISODOW convention: 1=Monday, 7=Sunday.
-- ============================================================

create or replace function generate_sessions_ahead(weeks_ahead integer default 4)
returns void
language plpgsql
as $$
declare
  tmpl record;
  week_offset integer;
  iso_week_monday date;
  target_date date;
begin
  for week_offset in 0..weeks_ahead - 1 loop
    -- Monday of the target week
    iso_week_monday := (date_trunc('week', now()))::date + (week_offset * 7);

    for tmpl in
      select * from class_templates where is_active = true
    loop
      -- ISODOW: 1=Monday → offset 0, 2=Tuesday → offset 1, ... 7=Sunday → offset 6
      target_date := iso_week_monday + (tmpl.day_of_week - 1);

      insert into class_sessions (template_id, session_date, start_time, end_time)
      values (tmpl.id, target_date, tmpl.start_time, tmpl.end_time)
      on conflict (template_id, session_date) do nothing;
    end loop;
  end loop;
end;
$$;
