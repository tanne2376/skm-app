import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { supabase, invokeFunction } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, PAYMENT_CANCELED } from '@/lib/stripe';
import { scheduleClassReminder } from '@/lib/notifications';
import { useAuth } from './useAuth';
import { useActiveMembership } from './useActiveMembership';
import { ClassSessionWithDetails, PaymentMethod } from '@/types';

interface BookSessionParams {
  session: ClassSessionWithDetails;
  paymentMethod: PaymentMethod;
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
        // App payment via Stripe
        const { data, error } = await invokeFunction<{
          clientSecret: string; customerId: string; ephemeralKeySecret: string;
        }>('create-payment-intent', { type: 'class', id: session.id });
        if (error) throw new Error(error.message ?? 'Could not create payment.');

        const { clientSecret, customerId, ephemeralKeySecret } = data!;

        await initializePaymentSheet({
          paymentIntentClientSecret: clientSecret,
          customerEphemeralKeySecret: ephemeralKeySecret,
          customerId,
          amount: session.effective_price,
        });

        const result = await openPaymentSheet();
        if (!result.success) {
          // Cancel the pending booking created by the edge function
          await supabase
            .from('bookings')
            .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', clientSecret.split('_secret_')[0]);
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

export async function joinWaitlist(sessionId: string, paymentMethod: PaymentMethod): Promise<number> {
  // Server-side RPC so the position read bypasses RLS (students can't
  // see each other's bookings) and concurrent joiners serialize on a
  // per-session advisory lock. Returns the assigned waitlist position.
  const { data, error } = await supabase.rpc('join_session_waitlist', {
    p_session_id: sessionId,
    p_payment_method: paymentMethod,
  });

  if (error) {
    if (error.code === '23505' || /already have a booking/i.test(error.message)) {
      throw new Error('You already have a booking for this class.');
    }
    throw new Error(error.message || 'Failed to join waitlist.');
  }

  return data as number;
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
