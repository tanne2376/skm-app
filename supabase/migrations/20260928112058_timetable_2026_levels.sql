-- Replace the weekly timetable with the 2026 Scrapyard timetable.
-- Templates matching an existing (day, start, end) slot are updated in place;
-- the rest are retired. "All levels" classes map to 'general'.

create temporary table new_timetable (
  name text, day_of_week smallint, start_time time, end_time time, level class_level
) on commit drop;

insert into new_timetable values
  ('Muay Thai',            1, '18:00', '19:00', 'beginners'),
  ('Pads & Clinch',        1, '19:00', '20:00', 'general'),
  ('Drills & Sparring',    1, '20:00', '21:00', 'fighters'),
  ('Boxing',               2, '18:30', '19:30', 'fighters'),
  ('K1 Drills / Sparring', 2, '19:30', '21:00', 'general'),
  ('K1 Drills',            3, '18:30', '19:30', 'beginners'),
  ('Muay Thai',            3, '19:30', '21:00', 'fighters'),
  ('Boxing Sparring',      4, '18:00', '19:00', 'general'),
  ('Muay Khao',            4, '19:00', '20:30', 'fighters'),
  ('Clinch / Sparring',    4, '20:30', '21:00', 'fighters'),
  ('Advanced K1 Drills',   5, '18:00', '19:00', 'fighters'),
  ('Sparring Class',       5, '19:00', '20:30', 'general'),
  ('Boxing',               6, '10:00', '11:00', 'general'),
  ('Pads Class',           6, '11:00', '12:00', 'general'),
  ('Clinch Club',          6, '12:00', '13:00', 'general');

-- class_templates has no unique (day, start, end) constraint; refuse to run if
-- a slot is already duplicated, since step 1 would rename every copy.
do $$
begin
  if exists (
    select 1 from class_templates where is_active
    group by day_of_week, start_time, end_time having count(*) > 1
  ) then
    raise exception 'Duplicate active class_templates for one timetable slot — resolve before running';
  end if;
end $$;

-- 1. Update templates that already occupy a slot.
update class_templates ct
set name = nt.name, level = nt.level, is_active = true
from new_timetable nt
where ct.day_of_week = nt.day_of_week
  and ct.start_time = nt.start_time
  and ct.end_time = nt.end_time
  and ct.is_active;

-- 2. Retire templates not on the new timetable.
create temporary table retired on commit drop as
select ct.id from class_templates ct
where ct.is_active
  and not exists (
    select 1 from new_timetable nt
    where nt.day_of_week = ct.day_of_week
      and nt.start_time = ct.start_time
      and nt.end_time = ct.end_time
  );

do $$
begin
  if exists (
    select 1 from bookings b join class_sessions s on s.id = b.session_id
    where s.template_id in (select id from retired)
      and s.session_date >= current_date
      and b.status <> 'cancelled'
  ) then
    raise exception 'Retired classes have live future bookings — cancel/refund them first';
  end if;
end $$;

update class_templates set is_active = false where id in (select id from retired);

-- Their future sessions: delete if never booked, otherwise cancel (bookings FK
-- is ON DELETE RESTRICT, and booking history must be kept).
delete from class_sessions s
where s.template_id in (select id from retired)
  and s.session_date >= current_date
  and not exists (select 1 from bookings b where b.session_id = s.id);

update class_sessions s
set is_cancelled = true, cancellation_reason = 'Timetable updated'
where s.template_id in (select id from retired)
  and s.session_date >= current_date
  and not s.is_cancelled;

-- 3. Add new slots.
insert into class_templates (name, day_of_week, start_time, end_time, level)
select nt.name, nt.day_of_week, nt.start_time, nt.end_time, nt.level
from new_timetable nt
where not exists (
  select 1 from class_templates ct
  where ct.is_active
    and ct.day_of_week = nt.day_of_week
    and ct.start_time = nt.start_time
    and ct.end_time = nt.end_time
);

select generate_sessions_ahead(4);
