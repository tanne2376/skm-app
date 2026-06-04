/**
 * Regression test for the "everyone gets waitlist position 1" bug.
 *
 * Old behaviour (buggy): joinWaitlist read max(waitlist_position)
 * from the bookings table on the client. RLS limits SELECT to the
 * caller's own bookings, so each new joiner saw an empty waitlist
 * and computed position 1.
 *
 * New behaviour: joinWaitlist calls the join_session_waitlist RPC,
 * which runs SECURITY DEFINER server-side and returns the assigned
 * position. The client no longer reads the bookings table to
 * compute position, so RLS visibility is irrelevant.
 */

jest.mock('../../lib/supabase', () => {
  const rpc = jest.fn();
  const from = jest.fn();
  return {
    supabase: { rpc, from },
    invokeFunction: jest.fn(),
  };
});

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test-anon-key' } } },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import { joinWaitlist } from '../../hooks/useBookSession';
import { supabase } from '../../lib/supabase';

const mockRpc = supabase.rpc as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

describe('joinWaitlist (client → server RPC)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockReset();
  });

  it('invokes the join_session_waitlist RPC with the session id and payment method', async () => {
    mockRpc.mockResolvedValueOnce({ data: 1, error: null });

    const position = await joinWaitlist('session-uuid-1', 'app');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('join_session_waitlist', {
      p_session_id: 'session-uuid-1',
      p_payment_method: 'app',
    });
    expect(position).toBe(1);
  });

  it('does NOT read bookings table on the client to compute waitlist_position', async () => {
    // This is the regression assertion: the buggy code path was
    //   supabase.from('bookings').select('waitlist_position')...
    // Authoritative position calc must now happen server-side.
    mockRpc.mockResolvedValueOnce({ data: 1, error: null });

    await joinWaitlist('session-uuid-1', 'app');

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns distinct positions when the server assigns them sequentially', async () => {
    // Simulates the real-world scenario: student A joins first
    // (server returns 1), student B joins second (server returns 2).
    // The client must trust whatever the server returns — not
    // recompute it.
    mockRpc
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: 2, error: null });

    const posA = await joinWaitlist('session-uuid-1', 'app');
    const posB = await joinWaitlist('session-uuid-1', 'app');

    expect(posA).toBe(1);
    expect(posB).toBe(2);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('translates a duplicate-booking error (23505) to a user message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "bookings_session_id_student_id_key"' },
    });

    await expect(joinWaitlist('session-uuid-1', 'app')).rejects.toThrow(
      'You already have a booking for this class.',
    );
  });

  it('also catches the duplicate case when the server raises a custom message', async () => {
    // The RPC raises with errcode 23505 AND a friendly message; we
    // match either to be resilient to PostgREST error reshaping.
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'You already have a booking for this class.' },
    });

    await expect(joinWaitlist('session-uuid-1', 'app')).rejects.toThrow(
      'You already have a booking for this class.',
    );
  });

  it('bubbles up other RPC errors verbatim', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Authentication required.' },
    });

    await expect(joinWaitlist('session-uuid-1', 'app')).rejects.toThrow(
      'Authentication required.',
    );
  });

  it('rejects when the server returns a non-numeric position (defensive boundary check)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(joinWaitlist('session-uuid-1', 'app')).rejects.toThrow(
      'Invalid waitlist position returned from server.',
    );
  });

  it('falls back to a generic message when the server returns no message', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: '' },
    });

    await expect(joinWaitlist('session-uuid-1', 'app')).rejects.toThrow(
      'Failed to join waitlist.',
    );
  });
});
