/**
 * Kids classes are booked per child. A tap on the class card should go
 * straight to a child when there's no choice to make, and only ask
 * "who is this for?" when it could mean more than one child.
 */
import { renderHook } from '@testing-library/react-native';
import { Booking, Child, ClassSessionWithDetails, MembershipWithUsage, Waiver } from '../../types';

let mockChildren: Child[] = [];
let mockWaivers: Waiver[] = [];
let mockMemberships: MembershipWithUsage[] = [];
const mockMutation = { mutate: jest.fn(), isPending: false };

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../lib/stripe', () => ({ formatGBP: (p: number) => `£${(p / 100).toFixed(2)}` }));
jest.mock('../../hooks/useChildren', () => ({ useChildren: () => ({ data: mockChildren }) }));
jest.mock('../../hooks/useWaiver', () => ({ useMyWaivers: () => ({ data: mockWaivers }) }));
jest.mock('../../hooks/useActiveMembership', () => ({
  useKidsMemberships: () => ({ data: mockMemberships }),
  isMembershipUsable: (m?: MembershipWithUsage) =>
    !!m && (m.status === 'active' || m.status === 'cancelling') && !m.cash_grace_expired,
}));
jest.mock('../../hooks/useBookSession', () => ({
  useBookChild: () => mockMutation,
  useCancelBooking: () => mockMutation,
  useClaimWaitlistSpot: () => mockMutation,
}));
jest.mock('../../hooks/useCreateSubscription', () => ({
  useCreateSubscription: () => mockMutation,
  useCreateCashMembership: () => mockMutation,
}));

import { useKidsClassActions } from '../../hooks/useKidsClassActions';

const child = (id: string, name: string): Child => ({
  id, parent_id: 'parent-1', full_name: name, date_of_birth: '2016-01-01', created_at: '2026-01-01T00:00:00Z',
});
const waiverFor = (childId: string) => ({ id: `w-${childId}`, child_id: childId } as Waiver);
const membershipFor = (childId: string): MembershipWithUsage => ({
  id: `m-${childId}`, student_id: 'parent-1', child_id: childId, tier: 'kids',
  stripe_subscription_id: null, stripe_price_id: null, status: 'active',
  payment_method: 'stripe', payment_status: 'paid', cash_confirmed_at: null, cash_confirmed_by: null,
  current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z',
  created_at: '2026-11-01T00:00:00Z', weekly_usage_count: 0, cash_grace_expires_at: null, cash_grace_expired: false,
});
const booking = (childId: string, over: Partial<Booking> = {}): Booking => ({
  id: `b-${childId}`, session_id: 's-1', student_id: 'parent-1', child_id: childId,
  status: 'confirmed', payment_method: 'membership', payment_status: 'paid',
  stripe_payment_intent_id: null, waitlist_position: null, claim_window_started_at: null,
  booked_at: '2026-11-01T00:00:00Z', cancelled_at: null, ...over,
});
const session = (childBookings: Booking[] = []) => ({
  id: 's-1', session_date: '2099-01-01', start_time: '17:00:00', end_time: '18:00:00',
  class_templates: { name: 'Kids Muay Thai', level: 'kids' },
  confirmed_count: 3, effective_capacity: 20, child_bookings: childBookings,
} as unknown as ClassSessionWithDetails);

const sam = child('c-sam', 'Sam');
const alex = child('c-alex', 'Alex');

function hook() {
  return renderHook(() => useKidsClassActions({ isBlockedFromBooking: false, lateCancelCount: 0 })).result.current;
}

describe('useKidsClassActions.soleChild', () => {
  beforeEach(() => {
    mockChildren = [];
    mockWaivers = [];
    mockMemberships = [];
  });

  it('picks the only child, whatever they need next', () => {
    mockChildren = [sam];
    const actions = hook();
    expect(actions.soleChild(session())?.id).toBe('c-sam');
    expect(actions.stateFor(session(), sam).kind).toBe('needs_waiver');
  });

  it('asks when there are no children', () => {
    expect(hook().soleChild(session())).toBeNull();
  });

  it('picks the only child who can be booked', () => {
    mockChildren = [sam, alex];
    mockWaivers = [waiverFor('c-sam'), waiverFor('c-alex')];
    mockMemberships = [membershipFor('c-sam')];
    const actions = hook();
    expect(actions.soleChild(session())?.id).toBe('c-sam');
    expect(actions.soleChildLabel(session())).toBe('Book');
  });

  it('asks when more than one child can be booked', () => {
    mockChildren = [sam, alex];
    mockWaivers = [waiverFor('c-sam'), waiverFor('c-alex')];
    mockMemberships = [membershipFor('c-sam'), membershipFor('c-alex')];
    expect(hook().soleChild(session())).toBeNull();
  });

  it('asks once one child is already booked', () => {
    mockChildren = [sam, alex];
    mockWaivers = [waiverFor('c-sam'), waiverFor('c-alex')];
    mockMemberships = [membershipFor('c-sam'), membershipFor('c-alex')];
    expect(hook().soleChild(session([booking('c-sam')]))).toBeNull();
  });

  it('picks the only child with a spot to claim', () => {
    mockChildren = [sam, alex];
    mockWaivers = [waiverFor('c-sam'), waiverFor('c-alex')];
    mockMemberships = [membershipFor('c-sam'), membershipFor('c-alex')];
    const s = session([
      booking('c-sam', { status: 'waitlisted', waitlist_position: 1, claim_window_started_at: new Date().toISOString() }),
      booking('c-alex', { status: 'waitlisted', waitlist_position: 2 }),
    ]);
    const actions = hook();
    expect(actions.soleChild(s)?.id).toBe('c-sam');
    expect(actions.soleChildLabel(s)).toBe('Claim Spot');
  });

  it('labels a single booked child with Cancel Booking', () => {
    mockChildren = [sam];
    mockWaivers = [waiverFor('c-sam')];
    mockMemberships = [membershipFor('c-sam')];
    expect(hook().soleChildLabel(session([booking('c-sam')]))).toBe('Cancel Booking');
  });
});
