import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { invokeFunction, supabase } from '@/lib/supabase';
import { initializePaymentSheet, openPaymentSheet, PAYMENT_CANCELED } from '@/lib/stripe';
import { useAuth } from './useAuth';

async function waitForActiveBlock(blockId: string, maxAttempts = 8): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data, error } = await supabase
      .from('blocks')
      .select('id')
      .eq('id', blockId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) {
      throw new Error(`Could not confirm block activation: ${error.message}`);
    }
    if (data) return;
  }
  throw new Error('Block did not activate in time. Check your purchases — payment may still complete shortly.');
}

export function useCreateCashBlockPurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const { data, error } = await invokeFunction<{ block_id: string }>(
        'create-block-purchase',
        { template_id: templateId, payment_method: 'cash' },
      );
      if (error) throw new Error(error.message ?? 'Could not start cash block.');
      return data!.block_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['block'] });
    },
    onError: (e: Error) => Alert.alert('Could not start block', e.message),
  });
}

export function useCreateStripeBlockPurchase() {
  const qc = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const { data, error } = await invokeFunction<{
        block_id: string;
        clientSecret: string;
        ephemeralKeySecret: string;
        customerId: string;
      }>('create-block-purchase', { template_id: templateId, payment_method: 'stripe' });
      if (error) throw new Error(error.message ?? 'Could not start payment.');

      const { data: tpl } = await supabase
        .from('block_templates')
        .select('price_pence, name')
        .eq('id', templateId)
        .single();

      await initializePaymentSheet({
        paymentIntentClientSecret: data!.clientSecret,
        customerEphemeralKeySecret: data!.ephemeralKeySecret,
        customerId: data!.customerId,
        amount: tpl?.price_pence ?? 0,
        merchantDisplayName: 'Switch-Kick Mafia',
      });

      const result = await openPaymentSheet();
      if (!result.success) {
        // Server has already created the pending_stripe row; release it so
        // the 15-minute pending guard doesn't block a retry.
        await supabase.rpc('abandon_pending_stripe_block', { p_block_id: data!.block_id });
        throw new Error(result.canceled ? PAYMENT_CANCELED : (result.error ?? 'Payment failed.'));
      }

      // Wait for the webhook to flip the row to active before returning.
      if (session?.user.id) {
        await waitForActiveBlock(data!.block_id);
      }
      return data!.block_id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['block'] });
    },
    onError: (e: Error) => {
      if (e.message === PAYMENT_CANCELED) return;
      Alert.alert('Block purchase failed', e.message);
    },
  });
}

export function useCancelBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (blockId: string) => {
      const { error } = await supabase.rpc('cancel_block', { p_block_id: blockId });
      if (error) throw new Error(error.message ?? 'Could not cancel block.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['block'] });
    },
    onError: (e: Error) => Alert.alert('Error', e.message),
  });
}

export function useBookOneToOneWithBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (oneToOneId: string) => {
      const { error } = await invokeFunction('book-one-to-one-with-block', {
        one_to_one_id: oneToOneId,
      });
      if (error) throw new Error(error.message ?? 'Could not book session.');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['one_to_ones'] });
      qc.invalidateQueries({ queryKey: ['block'] });
    },
    onError: (e: Error) => Alert.alert('Booking failed', e.message),
  });
}
