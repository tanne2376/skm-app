-- Save a class template and propagate leader/time changes to its future
-- sessions in one transaction. Sessions with a per-session override (a
-- substitute leader, or an individually edited time) are left alone.
-- SECURITY INVOKER: the caller's RLS applies ("Admins manage ..." policies).
create or replace function public.update_class_template(
  p_template_id uuid,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_capacity smallint,
  p_price integer,
  p_level class_level,
  p_teacher_id uuid
) returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  prev class_templates%rowtype;
  -- UK date, so the 00:00–01:00 BST window doesn't include yesterday.
  today date := (now() at time zone 'Europe/London')::date;
begin
  if get_user_role() is distinct from 'admin'::user_role then
    raise exception 'Only admins can edit the timetable' using errcode = '42501';
  end if;

  select * into prev from class_templates where id = p_template_id for update;
  if not found then
    raise exception 'Class template % not found', p_template_id;
  end if;

  update class_templates
  set name = p_name, start_time = p_start_time, end_time = p_end_time,
      capacity = p_capacity, price = p_price, level = p_level, teacher_id = p_teacher_id
  where id = p_template_id;

  if p_teacher_id is distinct from prev.teacher_id then
    update class_sessions
    set teacher_id = p_teacher_id
    where template_id = p_template_id
      and session_date >= today
      and (teacher_id is null or teacher_id = prev.teacher_id);
  end if;

  if p_start_time <> prev.start_time or p_end_time <> prev.end_time then
    update class_sessions
    set start_time = p_start_time, end_time = p_end_time
    where template_id = p_template_id
      and session_date >= today
      and start_time = prev.start_time
      and end_time = prev.end_time;
  end if;
end;
$$;

revoke execute on function public.update_class_template(uuid, text, time, time, smallint, integer, class_level, uuid) from public;
revoke execute on function public.update_class_template(uuid, text, time, time, smallint, integer, class_level, uuid) from anon;
grant execute on function public.update_class_template(uuid, text, time, time, smallint, integer, class_level, uuid) to authenticated;
