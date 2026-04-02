import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { invokeFunction } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet } from '@/lib/stripe';
import { MembershipTier } from '@/types';

export function useCreateSubscription() {
  const queryClient = useQueryClient();

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
      if (!result.success) throw new Error(result.error ?? 'Payment cancelled.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Subscription failed', error.message);
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (membershipId: string) => {
      // Get Stripe Customer Portal URL
      const { data, error } = await invokeFunction<{ url: string }>('get-portal-session');
      if (error) throw new Error('Could not open subscription management.');
      return data!;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });
}
