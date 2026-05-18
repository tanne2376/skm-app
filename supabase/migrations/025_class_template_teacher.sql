-- ============================================================
-- CLASS TEMPLATE LEADER (per template, not per session)
--
-- Before this migration: teacher_id lived only on class_sessions.
-- The admin UI inferred a "default leader" by sampling one of the
-- template's future sessions, and bulk-rewrote every future session
-- when the admin reassigned the leader. That worked for display but
-- made the template the implicit source of truth without storing it.
--
-- This migration solidifies the relationship: class_templates.teacher_id
-- is the canonical class leader. New sessions inherit it via
-- generate_sessions_ahead(). class_sessions.teacher_id is retained as a
-- per-session override (admin can swap in a substitute for a one-off
-- session) but is no longer the source of truth.
-- ============================================================

alter table class_templates
  add column teacher_id uuid references profiles(id) on delete set null;

create index class_templates_teacher_id_idx on class_templates(teacher_id);

-- Backfill: copy from the most recent future session for each template.
-- This matches the existing manage UI's inference logic (it picked the
-- teacher from one of the template's future sessions). Falls back to any
-- session if no future ones exist.
update class_templates ct
set teacher_id = sub.teacher_id
from (
  select distinct on (template_id) template_id, teacher_id
  from class_sessions
  where teacher_id is not null
  order by template_id, session_date desc
) sub
where sub.template_id = ct.id;

-- generate_sessions_ahead now copies teacher_id from the template,
-- so newly generated sessions inherit the leader without needing the
-- manage UI to bulk-rewrite them.
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
    iso_week_monday := (date_trunc('week', now()))::date + (week_offset * 7);

    for tmpl in
      select * from class_templates where is_active = true
    loop
      target_date := iso_week_monday + (tmpl.day_of_week - 1);

      insert into class_sessions (template_id, teacher_id, session_date, start_time, end_time)
      values (tmpl.id, tmpl.teacher_id, target_date, tmpl.start_time, tmpl.end_time)
      on conflict (template_id, session_date) do nothing;
    end loop;
  end loop;
end;
$$;
