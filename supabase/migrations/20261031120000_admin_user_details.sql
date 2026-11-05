-- Admin-only snapshot of one user for the Manage → Users details sheet:
-- profile, sign-in email (only readable from auth.users), children, and every
-- waiver on the account with its emergency contact. Signatures are left out
-- to keep the payload small.

create or replace function get_user_details(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if get_user_role() is distinct from 'admin' then
    raise exception 'Only admins can view user details.' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'phone', p.phone,
      'role', p.role,
      'created_at', p.created_at,
      'email', u.email,
      'children', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', c.id, 'full_name', c.full_name, 'date_of_birth', c.date_of_birth)
          order by c.created_at
        )
        from children c
        where c.parent_id = p.id
      ), '[]'::jsonb),
      'waivers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', w.id,
            'child_id', w.child_id,
            'child_name', w.child_name,
            'child_date_of_birth', w.child_date_of_birth,
            'guardian_relationship', w.guardian_relationship,
            'emergency_contact_name', w.emergency_contact_name,
            'emergency_contact_phone', w.emergency_contact_phone,
            'photo_consent', w.photo_consent,
            'signed_at', w.signed_at
          )
          order by w.signed_at
        )
        from waivers w
        where w.user_id = p.id
      ), '[]'::jsonb)
    )
    from profiles p
    left join auth.users u on u.id = p.id
    where p.id = p_user_id
  );
end;
$$;

revoke execute on function get_user_details(uuid) from public, anon;
grant execute on function get_user_details(uuid) to authenticated;
