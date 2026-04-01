import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet } from '@/lib/stripe';
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
        // Insert booking directly — teacher confirms cash later
        const { error } = await supabase.from('bookings').insert({
          session_id: session.id,
          student_id: authSession.user.id,
          status: 'confirmed',
          payment_method: 'cash',
          payment_status: 'pending',
        });
        if (error) {
          if (error.code === '23505') throw new Error('You already have a booking for this class.');
          // If class is full, try to join waitlist
          await joinWaitlist(session.id, authSession.user.id, 'cash');
        }

      } else if (paymentMethod === 'membership') {
        if (!membership) throw new Error('No active membership.');

        // Check 2x/week quota
        if (membership.tier === 'two_per_week' && membership.weekly_usage_count >= 2) {
          throw new Error('You have used your 2 classes for this week. Upgrade to unlimited for more.');
        }

        // Edge function handles quota insert + booking atomically
        const { error } = await supabase.functions.invoke('book-with-membership', {
          body: { session_id: session.id, membership_id: membership.id },
        });
        if (error) throw new Error(error.message ?? 'Failed to book with membership.');

      } else {
        // App payment via Stripe
        const { data, error } = await supabase.functions.invoke('create-payment-intent', {
          body: { type: 'class', id: session.id },
        });
        if (error) throw new Error(error.message ?? 'Could not create payment.');

        const { clientSecret, customerId, ephemeralKeySecret } = data as {
          clientSecret: string;
          customerId: string;
          ephemeralKeySecret: string;
        };

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
          throw new Error(result.error ?? 'Payment cancelled.');
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
      Alert.alert('Booking failed', error.message);
    },
  });
}

async function joinWaitlist(sessionId: string, studentId: string, paymentMethod: PaymentMethod) {
  // Get current max waitlist position
  const { data: existing } = await supabase
    .from('bookings')
    .select('waitlist_position')
    .eq('session_id', sessionId)
    .eq('status', 'waitlisted')
    .order('waitlist_position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (existing?.waitlist_position ?? 0) + 1;

  const { error } = await supabase.from('bookings').insert({
    session_id: sessionId,
    student_id: studentId,
    status: 'waitlisted',
    payment_method: paymentMethod,
    payment_status: 'pending',
    waitlist_position: nextPosition,
  });

  if (error) {
    if (error.code === '23505') throw new Error('You already have a booking for this class.');
    throw new Error('Failed to join waitlist.');
  }
}

export function useJoinWaitlist() {
  const queryClient = useQueryClient();
  const { session: authSession } = useAuth();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (!authSession) throw new Error('Not authenticated');
      await joinWaitlist(sessionId, authSession.user.id, 'app');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['class_sessions'] });
    },
    onError: (error: Error) => {
      Alert.alert('Waitlist', error.message);
    },
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (bookingId: string) => {
      const { data, error } = await supabase.functions.invoke('cancel-booking', {
        body: { bookingId },
      });
      if (error) throw new Error(error.message ?? 'Failed to cancel booking.');
      return data as { refunded: boolean; message: string };
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
