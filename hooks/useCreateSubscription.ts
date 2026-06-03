import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { invokeFunction, supabase } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, PAYMENT_CANCELED } from '@/lib/stripe';
import { MembershipTier } from '@/types';
import { useAuth } from './useAuth';

/** Poll until the membership row appears (created by the Stripe webhook). */
async function waitForMembership(userId: string, maxAttempts = 8): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data } = await supabase
      .from('memberships')
      .select('id')
      .eq('student_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (data) return;
  }
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async (tier: MembershipTier) => {
      const { data, error } = await invokeFunction<{
        subscriptionId: string; clientSecret: string; ephemeralKeySecret: string; customerId: string;
      }>('create-subscription', { tier });
      if (error) throw new Error(error.message ?? 'Could not create subscription.');

      const { clientSecret, ephemeralKeySecret, customerId } = data!;

      await initializePaymentSheet({
        paymentIntentClientSecret: clientSecret,
        customerEphemeralKeySecret: ephemeralKeySecret,
        customerId,
        amount: tier === 'unlimited' ? 10000 : 8000,
        merchantDisplayName: 'Switch-Kick Mafia',
      });

      const result = await openPaymentSheet();
      if (!result.success) throw new Error(result.canceled ? PAYMENT_CANCELED : (result.error ?? 'Payment failed.'));

      // Wait for the Stripe webhook to create the membership row before
      // returning so the UI switches to the active membership view.
      if (session?.user.id) {
        await waitForMembership(session.user.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      if (error.message === PAYMENT_CANCELED) return;
      Alert.alert('Subscription failed', error.message);
    },
  });
}

export function useCreateCashMembership() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tier: MembershipTier) => {
      const { error } = await supabase.rpc('create_cash_membership', { p_tier: tier });
      if (error) throw new Error(error.message ?? 'Could not create cash membership.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Could not start membership', error.message);
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await invokeFunction('cancel-subscription', {});
      if (error) throw new Error(error.message ?? 'Could not cancel membership.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });
}

export function useResumeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await invokeFunction('resume-subscription', {});
      if (error) throw new Error(error.message ?? 'Could not resume membership.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });
}
