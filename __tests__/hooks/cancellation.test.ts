/**
 * Tests for cancellation window business logic.
 * The 3-hour boundary must be exact — test both sides.
 */

const CANCELLATION_WINDOW_HOURS = 3;

function getCancellationOutcome(
  sessionStartIso: string,
  nowMs: number,
): 'full_refund' | 'no_refund' | 'past' {
  const sessionStart = new Date(sessionStartIso).getTime();
  const hoursUntil = (sessionStart - nowMs) / (1000 * 60 * 60);

  if (hoursUntil <= 0) return 'past';
  if (hoursUntil <= CANCELLATION_WINDOW_HOURS) return 'no_refund';
  return 'full_refund';
}

describe('Cancellation window logic', () => {
  const sessionStart = new Date('2026-04-01T18:30:00.000Z');

  it('gives full refund when cancelled >3 hours before (3h 1s before)', () => {
    const nowMs = sessionStart.getTime() - (3 * 3600 + 1) * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('full_refund');
  });

  it('gives full refund when cancelled exactly 3h 0m 1s before', () => {
    const nowMs = sessionStart.getTime() - (3 * 3600 + 1) * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('full_refund');
  });

  it('gives NO refund when cancelled exactly 3h 0m 0s before (on the boundary)', () => {
    const nowMs = sessionStart.getTime() - 3 * 3600 * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('no_refund');
  });

  it('gives NO refund when cancelled 2h 59m 59s before', () => {
    const nowMs = sessionStart.getTime() - (2 * 3600 + 59 * 60 + 59) * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('no_refund');
  });

  it('gives NO refund when cancelled 1 minute before', () => {
    const nowMs = sessionStart.getTime() - 60 * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('no_refund');
  });

  it('returns past when session has already started', () => {
    const nowMs = sessionStart.getTime() + 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('past');
  });

  it('returns past when session ended long ago', () => {
    const nowMs = sessionStart.getTime() + 24 * 3600 * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('past');
  });

  it('gives full refund for cancellation 24 hours before', () => {
    const nowMs = sessionStart.getTime() - 24 * 3600 * 1000;
    expect(getCancellationOutcome(sessionStart.toISOString(), nowMs)).toBe('full_refund');
  });
});

describe('Capacity check', () => {
  function canBook(confirmedCount: number, capacity: number): boolean {
    return confirmedCount < capacity;
  }

  it('allows booking when 19/20 spots taken', () => {
    expect(canBook(19, 20)).toBe(true);
  });

  it('blocks booking when 20/20 spots taken', () => {
    expect(canBook(20, 20)).toBe(false);
  });

  it('blocks when over capacity', () => {
    expect(canBook(21, 20)).toBe(false);
  });

  it('allows booking of first spot', () => {
    expect(canBook(0, 20)).toBe(true);
  });
});
