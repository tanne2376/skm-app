-- Kids membership tier. On its own migration because a new enum value can't
-- be used in the transaction that adds it.
alter type membership_tier add value if not exists 'kids';
