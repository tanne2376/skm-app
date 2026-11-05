-- Children on a parent's account, and one waiver per person.
--
-- An account holder can add any number of children (under 18). Waivers are
-- now per person: at most one adult waiver per account (child_id null) plus
-- one per child (child_id set, signed by the parent). The app unlocks once
-- the account has any waiver; booking a class or 1-to-1 for the account
-- holder additionally requires their own adult waiver (enforced by the next
-- migration, which must only ship alongside the app release that has waivers).
--
-- Bookings and memberships for children come later; until then every booking
-- is the account holder's, so the roster no longer swaps in a child's name.

-- ============================================================
-- children
-- ============================================================

create table children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references profiles(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 100),
  date_of_birth date not null,
  created_at timestamptz not null default now()
);

create index children_parent_id_idx on children(parent_id);

-- Trims the name, requires the child to be under 18 on today's UK date, and
-- caps children per account. A trigger rather than a CHECK because "today"
-- isn't immutable.
create or replace function validate_child()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  new.full_name := btrim(new.full_name);
  if new.date_of_birth >= v_today or new.date_of_birth <= (v_today - interval '18 years')::date then
    raise exception 'Children must be under 18. Anyone 18 or over needs their own account.'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and (select count(*) from children where parent_id = new.parent_id) >= 10 then
    raise exception 'You can add up to 10 children to an account.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger children_validate
  before insert or update on children
  for each row execute function validate_child();

alter table children enable row level security;

create policy "Parents read own children"
  on children for select
  to authenticated
  using (parent_id = (select auth.uid()));

create policy "Admins read all children"
  on children for select
  to authenticated
  using (get_user_role() = 'admin');

create policy "Parents add own children"
  on children for insert
  to authenticated
  with check (parent_id = (select auth.uid()));

-- A child with a signed waiver can't be removed (waivers.child_id FK below).
create policy "Parents remove own children"
  on children for delete
  to authenticated
  using (parent_id = (select auth.uid()));

revoke all on children from anon, authenticated;
grant select, delete on children to authenticated;
grant insert (parent_id, full_name, date_of_birth) on children to authenticated;

-- ============================================================
-- waivers: one per person
-- ============================================================

-- Default NO ACTION (not RESTRICT) so a cascading profile delete can remove
-- both the children and their waivers in one statement.
alter table waivers add column child_id uuid references children(id);

alter table waivers drop constraint waivers_user_id_key;
create unique index waivers_one_adult_per_user on waivers(user_id) where child_id is null;
create unique index waivers_one_per_child on waivers(child_id) where child_id is not null;

-- No existing rows have for_child = true, so this holds for current data.
alter table waivers add constraint waivers_child_link check (for_child = (child_id is not null));

-- Server-set fields: the signer's name from their profile, and for a child
-- waiver the child's name and date of birth from the children row (which
-- must belong to the signer). Snapshotted so the record survives later edits.
create or replace function set_waiver_signer_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select full_name into new.signer_name from profiles where id = new.user_id;
  if new.signer_name is null then
    raise exception 'No profile for waiver signer.';
  end if;

  new.for_child := new.child_id is not null;
  if new.for_child then
    select c.full_name, c.date_of_birth
      into new.child_name, new.child_date_of_birth
    from children c
    where c.id = new.child_id and c.parent_id = new.user_id;
    if not found then
      raise exception 'Child not found on this account.' using errcode = '42501';
    end if;
  else
    new.child_name := null;
    new.child_date_of_birth := null;
    new.guardian_relationship := null;
  end if;
  return new;
end;
$$;

revoke execute on function set_waiver_signer_name() from public, anon, authenticated;

revoke insert on waivers from authenticated;
grant insert (
  user_id, child_id, emergency_contact_name, emergency_contact_phone,
  photo_consent, guardian_relationship, signature
) on waivers to authenticated;

-- ============================================================
-- Roster: back to the account holder's name
-- ============================================================

-- An account can now have several waivers, so joining waivers on user_id
-- would duplicate rows. guardian_name stays in the signature for child
-- bookings, which will fill it in; for now it is always null.
create or replace function get_class_roster(p_session_id uuid)
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
    p.full_name                                                            as student_name,
    null::text                                                             as guardian_name,
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

-- ============================================================
-- Sign-up: children entered on the register screen
-- ============================================================

-- The register screen passes children as user metadata
-- ([{ full_name, date_of_birth: 'YYYY-MM-DD' }]) because the account can't
-- write rows until the email is verified. Bad entries are skipped rather
-- than failing the whole sign-up; the parent can add them later in Settings.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child jsonb;
begin
  insert into profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  );

  if jsonb_typeof(new.raw_user_meta_data->'children') = 'array' then
    -- validate_child caps an account at 10; don't process more than that.
    for v_child in
      select * from jsonb_array_elements(new.raw_user_meta_data->'children') limit 10
    loop
      begin
        insert into children (parent_id, full_name, date_of_birth)
        values (new.id, v_child->>'full_name', (v_child->>'date_of_birth')::date);
      exception when others then
        raise warning 'Skipped child on sign-up for %: %', new.id, sqlerrm;
      end;
    end loop;
  end if;

  return new;
end;
$$;
