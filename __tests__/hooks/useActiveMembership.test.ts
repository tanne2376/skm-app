/**
 * Tests for membershipWeekStart — the pure utility that determines
 * which Monday starts the current membership week.
 * Membership weeks run Mon 00:00 → Sun 12:00.
 */

import { membershipWeekStart, membershipWeekRange } from '@/lib/membershipWeek';

describe('membershipWeekStart', () => {
  it('returns the Monday for a Monday input', () => {
    const monday = new Date('2026-03-30T10:00:00Z');
    expect(membershipWeekStart(monday)).toBe('2026-03-30');
  });

  it('returns the Monday for a Wednesday input', () => {
    const wednesday = new Date('2026-04-01T10:00:00Z');
    expect(membershipWeekStart(wednesday)).toBe('2026-03-30');
  });

  it('returns the same Monday for Sunday before noon', () => {
    const sundayMorning = new Date('2026-04-05T10:00:00Z');
    expect(membershipWeekStart(sundayMorning)).toBe('2026-03-30');
  });

  it('returns next Monday for Sunday at noon or after', () => {
    const sundayNoon = new Date('2026-04-05T12:00:00Z');
    expect(membershipWeekStart(sundayNoon)).toBe('2026-04-06');
  });

  it('returns next Monday for Sunday evening', () => {
    const sundayEvening = new Date('2026-04-05T20:00:00Z');
    expect(membershipWeekStart(sundayEvening)).toBe('2026-04-06');
  });

  it('returns the Monday for a Saturday input', () => {
    const saturday = new Date('2026-04-04T10:00:00Z');
    expect(membershipWeekStart(saturday)).toBe('2026-03-30');
  });

  it('returns next Monday for a Monday in the next week', () => {
    const nextMonday = new Date('2026-04-06T10:00:00Z');
    expect(membershipWeekStart(nextMonday)).toBe('2026-04-06');
  });
});

describe('membershipWeekRange', () => {
  it('returns Mon–Sun range', () => {
    const wednesday = new Date('2026-04-01T10:00:00Z');
    expect(membershipWeekRange(wednesday)).toEqual({ from: '2026-03-30', to: '2026-04-05' });
  });

  it('flips to next week on Sunday after noon', () => {
    const sundayAfternoon = new Date('2026-04-05T14:00:00Z');
    expect(membershipWeekRange(sundayAfternoon)).toEqual({ from: '2026-04-06', to: '2026-04-12' });
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
