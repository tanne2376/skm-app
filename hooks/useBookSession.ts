import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { supabase, invokeFunction } from '@/lib/supabase';
import { initializePaymentSheet, initializeDeferredPaymentSheet, openPaymentSheet, PAYMENT_CANCELED } from '@/lib/stripe';
import { scheduleClassReminder } from '@/lib/notifications';
import { useAuth } from './useAuth';
import { useActiveMembership } from './useActiveMembership';
import { ClassSessionWithDetails, PaymentMethod } from '@/types';

interface BookSessionParams {
  session: ClassSessionWithDetails;
  paymentMethod: PaymentMethod;
}

/**
 * A class card payment whose PaymentSheet is (being) set up ahead of time.
 * `paymentIntentId` is set once the user presses Pay and the server has
 * created the PaymentIntent and pending booking.
 */
interface PreparedCardPayment {
  sessionId: string;
  ready: Promise<void>;
  paymentIntentId: string | null;
}

// PaymentSheet holds one configuration at a time, so set-ups run one after
// another and only the most recent one is used.
let latestPrepared: PreparedCardPayment | null = null;
let prepareQueue: Promise<unknown> = Promise.resolve();

/**
 * Start loading the card PaymentSheet for a class (deferred-intent flow).
 * Call it as soon as the payment options appear: by the time the user taps
 * "Card", the sheet opens instantly. Nothing is booked or charged until they
 * press Pay inside the sheet, so it costs nothing if they pay another way.
 */
export function prepareClassCardPayment(session: ClassSessionWithDetails): PreparedCardPayment {
  // Saving a card is a per-attempt choice; reuse the intent for retries
  // (e.g. after a decline) unless that choice changes.
  let created: { clientSecret: string; saved: boolean } | null = null;

  const prepared: PreparedCardPayment = {
    sessionId: session.id,
    paymentIntentId: null,
    ready: Promise.resolve(),
  };

  prepared.ready = prepareQueue.then(async () => {
    const { data, error } = await invokeFunction<{
      customerId: string; ephemeralKeySecret: string;
    }>('payment-sheet-customer');
    if (error) throw new Error(error.message ?? 'Could not start payment.');

    await initializeDeferredPaymentSheet({
      customerId: data!.customerId,
      customerEphemeralKeySecret: data!.ephemeralKeySecret,
      amount: session.effective_price,
      confirmHandler: async (_paymentMethod, shouldSavePaymentMethod, intentCreationCallback) => {
        if (created && created.saved === shouldSavePaymentMethod) {
          intentCreationCallback({ clientSecret: created.clientSecret });
          return;
        }
        // A different save choice needs a new intent; free the place held by the old one.
        if (prepared.paymentIntentId) await cancelPendingCardBooking(prepared.paymentIntentId);

        const { data: intent, error: intentError } = await invokeFunction<{ clientSecret: string }>(
          'create-payment-intent',
          { type: 'class', id: session.id, deferred: true, savePaymentMethod: shouldSavePaymentMethod },
        );
        if (intentError || !intent) {
          const message = intentError?.message ?? 'Could not create payment.';
          intentCreationCallback({ error: { code: 'Failed', message, localizedMessage: message } });
          return;
        }
        created = { clientSecret: intent.clientSecret, saved: shouldSavePaymentMethod };
        prepared.paymentIntentId = intent.clientSecret.split('_secret_')[0];
        intentCreationCallback({ clientSecret: intent.clientSecret });
      },
    });
  });
  prepareQueue = prepared.ready.catch(() => {});
  latestPrepared = prepared;
  return prepared;
}

async function cancelPendingCardBooking(paymentIntentId: string) {
  await supabase
    .from('bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntentId);
}

export function useBookSession() {
  const queryClient = useQueryClient();
  const { session: authSession } = useAuth();
  const { data: membership } = useActiveMembership();

  return useMutation({
    mutationFn: async ({ session, paymentMethod }: BookSessionParams) => {
      if (!authSession) throw new Error('Not authenticated');

      const sessionDateTime = new Date(`${session.session_date}T${session.start_time}`);

      if (paymentMethod === 'cash') {
        // Insert booking directly — teacher confirms cash later.
        // The home screen only routes to this branch when the class
        // has spots left; full-class taps go through useJoinWaitlist
        // instead, so any insert error here is a real failure.
        const { error } = await supabase.from('bookings').insert({
          session_id: session.id,
          student_id: authSession.user.id,
          status: 'confirmed',
          payment_method: 'cash',
          payment_status: 'pending',
        });
        if (error) {
          if (error.code === '23505') throw new Error('You already have a booking for this class.');
          throw new Error(error.message ?? 'Failed to book class.');
        }
        // Notify teacher/admins of the cash booking (best effort)
        try {
          await invokeFunction('notify-event', { event: 'class_booked_cash', sessionId: session.id });
        } catch (notifyError) {
          console.warn('Failed to dispatch class_booked_cash', notifyError);
        }

      } else if (paymentMethod === 'membership') {
        if (!membership) throw new Error('No active membership.');

        // Check 2x/week quota
        if (membership.tier === 'two_per_week' && membership.weekly_usage_count >= 2) {
          throw new Error('You have used your 2 classes for this week. Upgrade to unlimited for more.');
        }

        // Edge function handles quota insert + booking atomically
        const { error } = await invokeFunction('book-with-membership', {
          session_id: session.id, membership_id: membership.id,
        });
        if (error) throw new Error(error.message ?? 'Failed to book with membership.');

      } else {
        // App payment via Stripe (deferred intent — see prepareClassCardPayment)
        const prepared = latestPrepared?.sessionId === session.id
          ? latestPrepared
          : prepareClassCardPayment(session);
        try {
          await prepared.ready;
        } catch (e) {
          // A failed set-up shouldn't stick; the next attempt starts afresh.
          if (latestPrepared === prepared) latestPrepared = null;
          throw e;
        }

        const result = await openPaymentSheet();
        // Each sheet set-up is for one checkout.
        if (latestPrepared === prepared) latestPrepared = null;
        if (!result.success) {
          // Cancel the pending booking if the user got as far as pressing Pay.
          if (prepared.paymentIntentId) await cancelPendingCardBooking(prepared.paymentIntentId);
          throw new Error(result.canceled ? PAYMENT_CANCELED : (result.error ?? 'Payment failed.'));
        }

        // Schedule local reminders (push handled server-side via webhook)
        await scheduleClassReminder(session.id, session.class_templates.name, sessionDateTime, 60);
        await scheduleClassReminder(session.id, session.class_templates.name, sessionDateTime, 24 * 60);
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },

    onError: (error: Error) => {
      if (error.message === PAYMENT_CANCELED) return;
      Alert.alert('Booking failed', error.message);
    },
  });
}

// Subset of PaymentMethod that maps to the DB's payment_method_type
// enum. 'block' is excluded — it's a 1-to-1 payment type and the
// classes waitlist doesn't accept it.
type ClassPaymentMethod = Extract<PaymentMethod, 'app' | 'cash' | 'membership'>;

export async function joinWaitlist(
  sessionId: string,
  paymentMethod: ClassPaymentMethod,
  childId?: string,
): Promise<number> {
  // Server-side RPC so the position read bypasses RLS (students can't
  // see each other's bookings) and concurrent joiners serialize on a
  // per-session advisory lock. Returns the assigned waitlist position.
  const { data, error } = await supabase.rpc('join_session_waitlist', {
    p_session_id: sessionId,
    p_payment_method: paymentMethod,
    ...(childId && { p_child_id: childId }),
  });

  if (error) {
    if (error.code === '23505' || /already (have|has) a booking/i.test(error.message)) {
      throw new Error(childId ? 'This child already has a booking for this class.' : 'You already have a booking for this class.');
    }
    throw new Error(error.message || 'Failed to join waitlist.');
  }

  if (typeof data !== 'number' || !Number.isFinite(data)) {
    throw new Error('Invalid waitlist position returned from server.');
  }

  return data;
}

export function useJoinWaitlist() {
  const queryClient = useQueryClient();
  const { session: authSession } = useAuth();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (!authSession) throw new Error('Not authenticated');
      return joinWaitlist(sessionId, 'app');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
    },
    onError: (error: Error) => {
      Alert.alert('Waitlist', error.message);
    },
  });
}

interface BookChildParams {
  session: ClassSessionWithDetails;
  childId: string;
  membershipId: string; // the child's kids membership
}

/**
 * Books a child into a kids class with their kids membership, or puts them
 * on the waitlist when the class is full. Kids classes have no other way in.
 */
export function useBookChild() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ session, childId, membershipId }: BookChildParams) => {
      if (session.confirmed_count >= session.effective_capacity) {
        await joinWaitlist(session.id, 'membership', childId);
        return 'waitlisted' as const;
      }
      const { error } = await invokeFunction('book-with-membership', {
        session_id: session.id, membership_id: membershipId, child_id: childId,
      });
      if (error) throw new Error(error.message ?? 'Failed to book class.');
      return 'booked' as const;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
    },
    onError: (error: Error) => {
      Alert.alert('Booking failed', error.message);
    },
  });
}

interface ClaimParams {
  bookingId: string;
  paymentMethod: PaymentMethod;
  membershipId?: string;
  amount: number; // pence, for PaymentSheet
}

export function useClaimWaitlistSpot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ bookingId, paymentMethod, membershipId, amount }: ClaimParams) => {
      const { data, error } = await invokeFunction<{
        confirmed?: boolean;
        paymentMethod?: PaymentMethod;
        clientSecret?: string;
        customerId?: string;
        ephemeralKeySecret?: string;
      }>('claim-waitlist-spot', { bookingId, paymentMethod, membershipId });
      if (error) throw new Error(error.message ?? 'Failed to claim spot.');

      // Cash / membership confirmed server-side. App needs PaymentSheet.
      if (paymentMethod !== 'app') return data!;

      if (!data?.clientSecret || !data.customerId || !data.ephemeralKeySecret) {
        throw new Error('Missing payment details from server.');
      }

      await initializePaymentSheet({
        paymentIntentClientSecret: data.clientSecret,
        customerEphemeralKeySecret: data.ephemeralKeySecret,
        customerId: data.customerId,
        amount,
      });

      const result = await openPaymentSheet();
      if (!result.success) {
        // Roll the booking back so the spot can rotate to the next
        // waitlister. The server cancels the PaymentIntent on the
        // cancel-booking path.
        try {
          await invokeFunction('cancel-booking', { bookingId });
        } catch (cleanupError) {
          console.error('Failed to roll back claim:', cleanupError);
        }
        throw new Error(result.canceled ? PAYMENT_CANCELED : (result.error ?? 'Payment failed.'));
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      if (error.message === PAYMENT_CANCELED) return;
      Alert.alert('Claim failed', error.message);
    },
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await invokeFunction<{ refunded: boolean; message: string }>('cancel-booking', { bookingId });
      if (error) throw new Error(error.message ?? 'Failed to cancel booking.');
      return data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Cancellation failed', error.message);
    },
  });
}
