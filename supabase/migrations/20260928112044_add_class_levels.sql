-- Class levels drive the timetable colours (beginners = orange, fighters = olive,
-- general = grey, kids = white). 'kids' also marks classes covered by the kids
-- membership.

create type class_level as enum ('beginners', 'fighters', 'general', 'kids');

alter table class_templates
  add column level class_level not null default 'general';

-- Backfill from the "(Level)" suffix the old names used.
update class_templates set level = 'beginners' where name ilike '%(beginner%';
update class_templates set level = 'fighters'
  where name ilike '%(fighter%' or name ilike '%(intermediate%' or name ilike '%(advanced%';
