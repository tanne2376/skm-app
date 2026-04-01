import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet } from '@/lib/stripe';
import { MembershipTier } from '@/types';

export function useCreateSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tier: MembershipTier) => {
      const { data, error } = await supabase.functions.invoke('create-subscription', {
        body: { tier },
      });
      if (error) throw new Error(error.message ?? 'Could not create subscription.');

      const { clientSecret, customerId } = data as {
        subscriptionId: string;
        clientSecret: string;
        customerId: string;
      };

      await initializePaymentSheet({
        paymentIntentClientSecret: clientSecret,
        customerEphemeralKeySecret: clientSecret, // subscription uses client_secret directly
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
      const { data, error } = await supabase.functions.invoke('get-portal-session', {});
      if (error) throw new Error('Could not open subscription management.');
      return data as { url: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membership'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });
}
