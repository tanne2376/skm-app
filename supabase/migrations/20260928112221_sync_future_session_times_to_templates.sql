-- Future sessions generated before a template's time was edited kept the old
-- time. Realign un-cancelled future sessions of active templates.
update class_sessions s
set start_time = ct.start_time, end_time = ct.end_time
from class_templates ct
where ct.id = s.template_id
  and ct.is_active
  and s.session_date >= current_date
  and not s.is_cancelled
  and (s.start_time <> ct.start_time or s.end_time <> ct.end_time);
