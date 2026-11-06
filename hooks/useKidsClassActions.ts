import { Alert } from 'react-native';
import { router } from 'expo-router';
import { CANCELLATION_WINDOW_HOURS, MEMBERSHIP_PRICES_PENCE } from '@/constants';
import { formatGBP } from '@/lib/stripe';
import { findChildWaiver } from '@/lib/waiver';
import { Booking, Child, ClassSessionWithDetails, MembershipWithUsage } from '@/types';
import { useChildren } from './useChildren';
import { useMyWaivers } from './useWaiver';
import { isMembershipUsable, useKidsMemberships } from './useActiveMembership';
import { useBookChild, useCancelBooking, useClaimWaitlistSpot } from './useBookSession';
import { useCreateCashMembership, useCreateSubscription } from './useCreateSubscription';

const CLAIM_WINDOW_MS = 60 * 60 * 1000;

/** Where one child stands for one kids class, and so what their next step is. */
export type ChildClassState =
  | { kind: 'booked'; booking: Booking }
  | { kind: 'claim'; booking: Booking; minutesLeft: number; membership: MembershipWithUsage | undefined }
  | { kind: 'waitlisted'; booking: Booking }
  | { kind: 'needs_waiver' }
  | { kind: 'needs_membership'; membership: MembershipWithUsage | undefined }
  | { kind: 'blocked' }
  | { kind: 'bookable'; membership: MembershipWithUsage };

interface Options {
  isBlockedFromBooking: boolean;
  lateCancelCount: number;
}

/**
 * Booking kids classes, one child at a time. Kids classes are membership-only,
 * so each child's next step is booking, claiming, cancelling, or getting what
 * they're missing (a waiver or a kids membership).
 */
export function useKidsClassActions({ isBlockedFromBooking, lateCancelCount }: Options) {
  const { data: children } = useChildren();
  const { data: waivers } = useMyWaivers();
  const { data: kidsMemberships } = useKidsMemberships();
  const bookChild = useBookChild();
  const cancelBooking = useCancelBooking();
  const claimSpot = useClaimWaitlistSpot();
  const createSubscription = useCreateSubscription();
  const createCashMembership = useCreateCashMembership();
  const isMutating = bookChild.isPending || cancelBooking.isPending || claimSpot.isPending
    || createSubscription.isPending || createCashMembership.isPending;
  // Until all three load, a child's state can't be known.
  const ready = !!children && !!waivers && !!kidsMemberships;

  function stateFor(session: ClassSessionWithDetails, child: Child): ChildClassState {
    const booking = session.child_bookings.find((b) => b.child_id === child.id);
    const membership = kidsMemberships?.find((m) => m.child_id === child.id);

    if (booking?.status === 'confirmed') return { kind: 'booked', booking };
    if (booking?.status === 'waitlisted') {
      const startedAt = booking.claim_window_started_at ? new Date(booking.claim_window_started_at).getTime() : null;
      const elapsed = startedAt === null ? Infinity : Date.now() - startedAt;
      if (elapsed < CLAIM_WINDOW_MS) {
        return { kind: 'claim', booking, membership, minutesLeft: Math.max(1, Math.ceil((CLAIM_WINDOW_MS - elapsed) / 60000)) };
      }
      return { kind: 'waitlisted', booking };
    }
    if (!waivers || !findChildWaiver(waivers, child.id)) return { kind: 'needs_waiver' };
    if (!isMembershipUsable(membership)) return { kind: 'needs_membership', membership };
    if (isBlockedFromBooking) return { kind: 'blocked' };
    return { kind: 'bookable', membership: membership! };
  }

  function cancel(session: ClassSessionWithDetails, child: Child, booking: Booking) {
    if (booking.status === 'waitlisted') {
      Alert.alert('Leave Waitlist', `Take ${child.full_name} off the waitlist?`, [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => cancelBooking.mutate(booking.id) },
      ]);
      return;
    }
    const hoursUntil = (new Date(`${session.session_date}T${session.start_time}`).getTime() - Date.now()) / 3_600_000;
    Alert.alert(
      'Cancel Booking',
      hoursUntil <= CANCELLATION_WINDOW_HOURS
        ? `Cancelling within ${CANCELLATION_WINDOW_HOURS} hours is a late cancellation (${lateCancelCount + 1} of 3 this month). At 3 you can’t book classes for the rest of the month.`
        : `Cancel ${child.full_name}’s booking?`,
      [
        { text: 'Keep Booking', style: 'cancel' },
        { text: 'Cancel Booking', style: 'destructive', onPress: () => cancelBooking.mutate(booking.id) },
      ],
    );
  }

  function offerMembership(child: Child, membership: MembershipWithUsage | undefined) {
    if (membership) {
      // Has one, but it can't be used: payment failed or cash overdue.
      Alert.alert(
        'Kids membership paused',
        membership.status === 'past_due'
          ? `The last payment for ${child.full_name}’s kids membership failed. Update your payment method to book.`
          : `${child.full_name}’s kids membership is paused until a class leader confirms the cash payment.`,
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'View Membership', onPress: () => router.push('/(app)/membership') },
        ],
      );
      return;
    }
    const price = formatGBP(MEMBERSHIP_PRICES_PENCE.kids);
    const onActive = {
      onSuccess: () => Alert.alert('Kids membership active', `You can now book ${child.full_name} into kids classes.`),
    };
    Alert.alert(
      'Kids membership needed',
      `Kids classes are booked with a kids membership: ${price}/month for ${child.full_name}, unlimited kids classes.`,
      [
        { text: 'Not Now', style: 'cancel' },
        { text: 'Pay with Cash', onPress: () => createCashMembership.mutate({ tier: 'kids', childId: child.id }, onActive) },
        { text: `Subscribe — ${price}/mo`, onPress: () => createSubscription.mutate({ tier: 'kids', childId: child.id }, onActive) },
      ],
    );
  }

  /**
   * The child's next step for this class (book, claim, cancel, sign, subscribe).
   * `announce` confirms who was booked, for taps that picked the child for the
   * parent.
   */
  function act(session: ClassSessionWithDetails, child: Child, { announce = false } = {}) {
    const state = stateFor(session, child);
    switch (state.kind) {
      case 'booked':
      case 'waitlisted':
        cancel(session, child, state.booking);
        return;
      case 'claim':
        if (!isMembershipUsable(state.membership)) {
          offerMembership(child, state.membership);
          return;
        }
        claimSpot.mutate({ bookingId: state.booking.id, paymentMethod: 'membership', membershipId: state.membership!.id, amount: 0 });
        return;
      case 'needs_waiver':
        Alert.alert('Waiver needed', `Sign ${child.full_name}’s waiver before booking them into a class.`, [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Sign Now', onPress: () => router.push({ pathname: '/sign-waiver', params: { childId: child.id } }) },
        ]);
        return;
      case 'needs_membership':
        offerMembership(child, state.membership);
        return;
      case 'blocked':
        Alert.alert('Booking Blocked', 'You are blocked from booking classes for the rest of this month due to 3 or more late cancellations.');
        return;
      case 'bookable':
        bookChild.mutate({ session, childId: child.id, membershipId: state.membership.id }, {
          onSuccess: (result) => {
            if (!announce) return;
            Alert.alert(
              result === 'booked' ? 'Booked' : 'On the waitlist',
              `${child.full_name} is ${result === 'booked' ? 'booked into' : 'on the waitlist for'} ${session.class_templates.name}.`,
            );
          },
        });
        return;
    }
  }

  /**
   * The one child a tap on the class card must be for, if there's no choice to
   * make: the only child on the account, or the only child who could claim a
   * spot, or (with nobody booked yet) the only child who could be booked.
   * Null means ask, via the "who is this for?" sheet.
   */
  function soleChild(session: ClassSessionWithDetails): Child | null {
    if (!ready || !children || children.length === 0) return null;
    if (children.length === 1) return children[0];
    const states = children.map((c) => ({ child: c, state: stateFor(session, c) }));
    const claimable = states.filter((s) => s.state.kind === 'claim');
    if (claimable.length > 0) return claimable.length === 1 ? claimable[0].child : null;
    if (session.child_bookings.length > 0) return null;
    const bookable = states.filter((s) => s.state.kind === 'bookable');
    return bookable.length === 1 ? bookable[0].child : null;
  }

  /** Card button label when the tap goes straight to one child. */
  function soleChildLabel(session: ClassSessionWithDetails): string | undefined {
    const child = soleChild(session);
    if (!child) return undefined;
    const isFull = session.confirmed_count >= session.effective_capacity;
    switch (stateFor(session, child).kind) {
      case 'booked': return 'Cancel Booking';
      case 'waitlisted': return 'Leave Waitlist';
      case 'claim': return 'Claim Spot';
      default: return isFull ? 'Join Waitlist' : 'Book';
    }
  }

  return { children, ready, isMutating, stateFor, act, cancel, soleChild, soleChildLabel };
}

export type KidsClassActions = ReturnType<typeof useKidsClassActions>;
