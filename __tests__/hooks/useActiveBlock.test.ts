/**
 * Tests for deriveBlockState — pure derivation of UI flags from a stored
 * block row. Covers the matrix that decides whether a 1-to-1 booking can
 * skip payment.
 */

import { deriveBlockState } from '@/lib/blockState';
import { Block } from '@/types';

const NOW = new Date('2026-05-04T12:00:00Z');

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b-1',
    student_id: 'u-1',
    template_id: 't-1',
    template_name_snapshot: '5 sessions',
    sessions_total: 5,
    validity_days_snapshot: 30,
    price_pence_snapshot: 6000,
    status: 'active',
    payment_method: 'stripe',
    payment_status: 'paid',
    sessions_used: 0,
    cash_confirmed_at: null,
    cash_confirmed_by: null,
    stripe_payment_intent_id: 'pi_1',
    created_at: '2026-05-01T12:00:00Z',
    activated_at: '2026-05-01T12:00:00Z',
    expires_at: '2026-05-31T12:00:00Z',
    ...overrides,
  };
}

describe('deriveBlockState', () => {
  it('marks an active stripe-paid block as usable', () => {
    const d = deriveBlockState(makeBlock(), NOW);
    expect(d.is_usable).toBe(true);
    expect(d.sessions_remaining).toBe(5);
    expect(d.is_expired).toBe(false);
  });

  it('computes sessions_remaining as total - used', () => {
    const d = deriveBlockState(makeBlock({ sessions_used: 3 }), NOW);
    expect(d.sessions_remaining).toBe(2);
    expect(d.is_usable).toBe(true);
  });

  it('marks block as not usable when fully used', () => {
    const d = deriveBlockState(makeBlock({ sessions_used: 5 }), NOW);
    expect(d.sessions_remaining).toBe(0);
    expect(d.is_usable).toBe(false);
  });

  it('marks block as expired when expires_at is in the past', () => {
    const d = deriveBlockState(makeBlock({ expires_at: '2026-04-30T12:00:00Z' }), NOW);
    expect(d.is_expired).toBe(true);
    expect(d.is_usable).toBe(false);
  });

  it('treats null expires_at as never-expires', () => {
    const d = deriveBlockState(makeBlock({ expires_at: null }), NOW);
    expect(d.is_expired).toBe(false);
    expect(d.is_usable).toBe(true);
  });

  it('marks cash-pending block as usable within 72h grace', () => {
    // Created 12h ago, well within grace
    const d = deriveBlockState(
      makeBlock({
        payment_method: 'cash',
        payment_status: 'pending',
        created_at: '2026-05-04T00:00:00Z',
      }),
      NOW,
    );
    expect(d.cash_grace_expired).toBe(false);
    expect(d.is_usable).toBe(true);
    expect(d.cash_grace_expires_at).toBe('2026-05-07T00:00:00.000Z');
  });

  it('marks cash-pending block as paused once grace expires', () => {
    // Created 80h before NOW = past 72h grace
    const d = deriveBlockState(
      makeBlock({
        payment_method: 'cash',
        payment_status: 'pending',
        created_at: '2026-05-01T04:00:00Z',
      }),
      NOW,
    );
    expect(d.cash_grace_expired).toBe(true);
    expect(d.is_usable).toBe(false);
  });

  it('does not compute grace for paid cash blocks', () => {
    const d = deriveBlockState(
      makeBlock({
        payment_method: 'cash',
        payment_status: 'paid',
      }),
      NOW,
    );
    expect(d.cash_grace_expired).toBe(false);
    expect(d.cash_grace_expires_at).toBeNull();
    expect(d.is_usable).toBe(true);
  });

  it('marks block as not usable when status is not active', () => {
    const d = deriveBlockState(makeBlock({ status: 'exhausted', sessions_used: 5 }), NOW);
    expect(d.is_usable).toBe(false);
  });
});
