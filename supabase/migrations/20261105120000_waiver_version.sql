-- Record which wording each waiver was signed under, so the read-only screen
-- shows what the signer actually agreed to even after the text is revised.
-- Existing rows were all signed under the 2026 wording. The client sends its
-- WAIVER_VERSION (constants/waiver.ts); the default covers older builds.

alter table waivers
  add column waiver_version text not null default '2026'
    check (waiver_version ~ '^[A-Za-z0-9._-]{1,20}$');

revoke insert on waivers from authenticated;
grant insert (
  user_id, child_id, waiver_version, emergency_contact_name, emergency_contact_phone,
  photo_consent, guardian_relationship, signature
) on waivers to authenticated;
