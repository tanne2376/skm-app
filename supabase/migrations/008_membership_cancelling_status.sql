-- Add 'cancelling' to the membership_status enum.
-- Used when a user cancels but the subscription remains active until period end.
ALTER TYPE membership_status ADD VALUE 'cancelling' AFTER 'active';
