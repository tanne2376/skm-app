-- Rosters show the child's name for accounts whose waiver was signed by a
-- parent on the child's behalf, with the parent in guardian_name.
-- Adding a column to RETURNS TABLE needs a drop; body is otherwise unchanged
-- from the live definition (036's null-role guard included).

drop function if exists get_class_roster(uuid);

create function get_class_roster(p_session_id uuid)
returns table (
  booking_id uuid,
  student_id uuid,
  student_name text,
  guardian_name text,
  booked_at timestamptz,
  payment_method text,
  payment_status text,
  membership_id uuid,
  membership_tier text,
  membership_payment_method text,
  membership_payment_status text,
  follow_up_amount_pence integer,
  cash_pending boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_user_role();
begin
  if v_role is null or v_role not in ('teacher', 'admin') then
    raise exception 'Only teachers and admins can view class rosters.';
  end if;

  if v_role = 'teacher'
     and not exists (
       select 1
       from class_sessions s
       where s.id = p_session_id
         and s.teacher_id = auth.uid()
     ) then
    raise exception 'Teachers can only view rosters for their own sessions.';
  end if;

  return query
  with class_price as (
    select coalesce(s.price, t.price) as price
    from class_sessions s
    join class_templates t on t.id = s.template_id
    where s.id = p_session_id
  )
  select
    b.id                                                                   as booking_id,
    b.student_id,
    case when w.for_child then w.child_name else p.full_name end           as student_name,
    case when w.for_child then p.full_name end                             as guardian_name,
    b.booked_at,
    b.payment_method::text                                                 as payment_method,
    b.payment_status::text                                                 as payment_status,
    m.id                                                                   as membership_id,
    m.tier::text                                                           as membership_tier,
    m.payment_method::text                                                 as membership_payment_method,
    m.payment_status::text                                                 as membership_payment_status,
    case
      when b.payment_method = 'membership' and m.tier = 'two_per_week' then 8000
      when b.payment_method = 'membership' and m.tier = 'unlimited'    then 10000
      when b.payment_method = 'cash'                                  then (select price from class_price)
      else null
    end                                                                    as follow_up_amount_pence,
    case
      when b.payment_method = 'cash' and b.payment_status = 'pending'                                         then true
      when b.payment_method = 'membership' and m.payment_method = 'cash' and m.payment_status = 'pending'     then true
      else false
    end                                                                    as cash_pending
  from bookings b
  join profiles p on p.id = b.student_id
  left join waivers w on w.user_id = b.student_id
  left join lateral (
    select *
    from memberships mi
    where mi.student_id = b.student_id
      and mi.status in ('active', 'cancelling')
    order by mi.created_at desc
    limit 1
  ) m on b.payment_method = 'membership'
  where b.session_id = p_session_id
    and b.status = 'confirmed'
  order by b.booked_at asc;
end;
$$;

revoke execute on function get_class_roster(uuid) from public, anon;
grant execute on function get_class_roster(uuid) to authenticated, service_role;
