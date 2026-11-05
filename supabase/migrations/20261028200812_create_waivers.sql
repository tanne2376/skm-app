-- Signed participation waivers (The Scrapyard Combat Academy participation,
-- gym & sauna acknowledgment). One row per user; the app blocks everything
-- until the signed-in user has a row here.
--
-- The signer is the account holder, so their details come from `profiles`.
-- A parent can instead sign on behalf of their child (for_child), in which
-- case the account represents the child: rosters show child_name.
--
-- Signatures are stored as small self-contained SVG documents drawn on the
-- device. Rows are immutable once written: there are no update/delete
-- policies, and signer_name / signed_at are server-set.

create table waivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  signer_name text not null,
  emergency_contact_name text not null check (char_length(btrim(emergency_contact_name)) > 0),
  emergency_contact_phone text not null check (char_length(btrim(emergency_contact_phone)) > 0),
  photo_consent boolean not null,
  for_child boolean not null default false,
  child_name text,
  child_date_of_birth date,
  guardian_relationship text,
  signature text not null
    check (signature like '<svg%' and char_length(signature) <= 200000),
  signed_at timestamptz not null default now(),

  -- Child fields are all-or-nothing, and the child must be under 18 on the
  -- UK date of signing.
  constraint waivers_child_details check (
    case when for_child then
      char_length(btrim(coalesce(child_name, ''))) > 0
      and char_length(btrim(coalesce(guardian_relationship, ''))) > 0
      and child_date_of_birth is not null
      and child_date_of_birth < (signed_at at time zone 'Europe/London')::date
      and child_date_of_birth > ((signed_at at time zone 'Europe/London')::date - interval '18 years')::date
    else
      child_name is null and child_date_of_birth is null and guardian_relationship is null
    end
  )
);

-- Snapshot the signer's name from their profile so the record can't be
-- forged and survives later profile edits.
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
  return new;
end;
$$;

revoke execute on function set_waiver_signer_name() from public, anon, authenticated;

create trigger waivers_set_signer_name
  before insert on waivers
  for each row execute function set_waiver_signer_name();

alter table waivers enable row level security;

create policy "Users read own waiver"
  on waivers for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Admins read all waivers"
  on waivers for select
  to authenticated
  using (get_user_role() = 'admin');

create policy "Users sign own waiver"
  on waivers for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Column-level grants: clients may not choose id, signer_name or signed_at,
-- and there is no update/delete for anyone but the service role.
revoke all on waivers from anon, authenticated;
grant select on waivers to authenticated;
grant insert (
  user_id, emergency_contact_name, emergency_contact_phone, photo_consent,
  for_child, child_name, child_date_of_birth, guardian_relationship, signature
) on waivers to authenticated;
