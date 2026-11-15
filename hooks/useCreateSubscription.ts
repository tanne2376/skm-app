import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { invokeFunction, supabase } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, PAYMENT_CANCELED } from '@/lib/stripe';
import { MEMBERSHIP_PRICES_PENCE } from '@/constants';
import { MembershipTier } from '@/types';
import { useAuth } from './useAuth';

/** Which membership to start: an adult tier, or the kids tier for one child. */
export type NewMembership =
  | { tier: Exclude<MembershipTier, 'kids'>; childId?: undefined }
  | { tier: 'kids'; childId: string };

/** Poll until the membership row appears (created by the Stripe webhook). */
async function waitForMembership(userId: string, childId: string | undefined, maxAttempts = 8): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const query = supabase
      .from('memberships')
      .select('id')
      .eq('student_id', userId)
      .eq('status', 'active');
    const { data } = await (childId ? query.eq('child_id', childId) : query.is('child_id', null)).maybeSingle();
    if (data) return;
  }
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({ tier, childId }: NewMembership) => {
      const { data, error } = await invokeFunction<{
        subscriptionId: string; clientSecret: string; ephemeralKeySecret: string; customerId: string;
      }>('create-subscription', { tier, childId });
      if (error) throw new Error(error.message ?? 'Could not create subscription.');

      const { clientSecret, ephemeralKeySecret, customerId } = data!;

      await initializePaymentSheet({
        paymentIntentClientSecret: clientSecret,
        customerEphemeralKeySecret: ephemeralKeySecret,
        customerId,
        amount: MEMBERSHIP_PRICES_PENCE[tier],
        merchantDisplayName: 'Switch-Kick Mafia',
      });

      const result = await openPaymentSheet();
      if (!result.success) throw new Error(result.canceled ? PAYMENT_CANCELED : (result.error ?? 'Payment failed.'));

      // Wait for the Stripe webhook to create the membership row before
      // returning so the UI switches to the active membership view.
      if (session?.user.id) {
        await waitForMembership(session.user.id, childId);
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
    mutationFn: async ({ tier, childId }: NewMembership) => {
      const { error } = await supabase.rpc(
        'create_cash_membership',
        childId ? { p_tier: tier, p_child_id: childId } : { p_tier: tier },
      );
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
    // Omit membershipId for the account holder's own membership.
    mutationFn: async (membershipId?: string) => {
      const { error } = await invokeFunction('cancel-subscription', membershipId ? { membershipId } : {});
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
    // Omit membershipId for the account holder's own membership.
    mutationFn: async (membershipId?: string) => {
      const { error } = await invokeFunction('resume-subscription', membershipId ? { membershipId } : {});
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
