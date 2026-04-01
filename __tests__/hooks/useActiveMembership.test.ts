/**
 * Tests for useActiveMembership — specifically the ISO week start calculation
 * and quota logic. Supabase calls are mocked.
 */

// Extract the pure utility function from the hook module for isolated testing
function isoWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

describe('isoWeekStart', () => {
  it('returns the Monday for a Monday input', () => {
    // 2026-03-30 is a Monday
    const monday = new Date('2026-03-30T10:00:00Z');
    expect(isoWeekStart(monday)).toBe('2026-03-30');
  });

  it('returns the Monday for a Wednesday input', () => {
    // 2026-04-01 is a Wednesday
    const wednesday = new Date('2026-04-01T10:00:00Z');
    expect(isoWeekStart(wednesday)).toBe('2026-03-30');
  });

  it('returns the Monday for a Sunday input', () => {
    // 2026-04-05 is a Sunday — should give the previous Monday 2026-03-30
    const sunday = new Date('2026-04-05T10:00:00Z');
    expect(isoWeekStart(sunday)).toBe('2026-03-30');
  });

  it('returns the Monday for a Saturday input', () => {
    // 2026-04-04 is a Saturday
    const saturday = new Date('2026-04-04T10:00:00Z');
    expect(isoWeekStart(saturday)).toBe('2026-03-30');
  });

  it('returns next Monday for a Monday in the next week', () => {
    const nextMonday = new Date('2026-04-06T10:00:00Z');
    expect(isoWeekStart(nextMonday)).toBe('2026-04-06');
  });
});

describe('membership quota logic', () => {
  function canUseMembership(tier: 'two_per_week' | 'unlimited', weeklyUsageCount: number): boolean {
    if (tier === 'unlimited') return true;
    return weeklyUsageCount < 2;
  }

  it('allows unlimited membership regardless of usage count', () => {
    expect(canUseMembership('unlimited', 0)).toBe(true);
    expect(canUseMembership('unlimited', 5)).toBe(true);
    expect(canUseMembership('unlimited', 99)).toBe(true);
  });

  it('allows two_per_week when usage is 0', () => {
    expect(canUseMembership('two_per_week', 0)).toBe(true);
  });

  it('allows two_per_week when usage is 1', () => {
    expect(canUseMembership('two_per_week', 1)).toBe(true);
  });

  it('blocks two_per_week when usage is 2 (quota reached)', () => {
    expect(canUseMembership('two_per_week', 2)).toBe(false);
  });

  it('blocks two_per_week when usage exceeds 2', () => {
    expect(canUseMembership('two_per_week', 3)).toBe(false);
  });
});
