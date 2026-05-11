import { Block, BlockWithDerived } from '@/types';

const GRACE_HOURS = 72;

/**
 * Pure derivation of UI state from a stored block row. Used by useActiveBlock
 * and unit-testable in isolation (no supabase import).
 */
export function deriveBlockState(block: Block, now: Date = new Date()): BlockWithDerived {
  const nowMs = now.getTime();
  const sessionsRemaining = block.sessions_total - block.sessions_used;
  const isExpired = !!(block.expires_at && new Date(block.expires_at).getTime() < nowMs);

  let cashGraceExpiresAt: string | null = null;
  let cashGraceExpired = false;
  if (block.payment_method === 'cash' && block.payment_status === 'pending') {
    const expiry = new Date(new Date(block.created_at).getTime() + GRACE_HOURS * 60 * 60 * 1000);
    cashGraceExpiresAt = expiry.toISOString();
    cashGraceExpired = expiry.getTime() <= nowMs;
  }

  const isUsable =
    block.status === 'active' &&
    sessionsRemaining > 0 &&
    !isExpired &&
    (block.payment_status === 'paid' || !cashGraceExpired);

  return {
    ...block,
    sessions_remaining: sessionsRemaining,
    is_usable: isUsable,
    is_expired: isExpired,
    cash_grace_expires_at: cashGraceExpiresAt,
    cash_grace_expired: cashGraceExpired,
  };
}
