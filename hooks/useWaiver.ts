import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { findAdultWaiver } from '@/lib/waiver';
import { Waiver } from '@/types';
import { useAuth } from './useAuth';

export type WaiverInput = Pick<
  Waiver,
  'child_id' | 'emergency_contact_name' | 'emergency_contact_phone' | 'photo_consent' | 'guardian_relationship' | 'signature'
>;

/**
 * Every waiver on the signed-in account: at most one for the account holder
 * (child_id null) plus one per child. Empty until they've signed anything.
 */
export function useMyWaivers() {
  const { session, isEmailVerified } = useAuth();
  const userId = session?.user.id;

  return useQuery<Waiver[]>({
    queryKey: ['waivers', userId],
    enabled: !!userId && isEmailVerified,
    staleTime: Infinity, // rows are immutable; only signing changes this
    queryFn: async () => {
      const { data, error } = await supabase
        .from('waivers')
        .select('*')
        .eq('user_id', userId!)
        .order('signed_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useSignWaiver() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  return useMutation({
    mutationFn: async (input: WaiverInput) => {
      const { data, error } = await supabase
        .from('waivers')
        .insert({ ...input, user_id: userId! })
        .select('*')
        .single();
      // Already signed for this person (e.g. on another device) — fall through to a refetch.
      if (error?.code === '23505') return null;
      if (error) throw error;
      return data as Waiver;
    },
    onSuccess: (waiver) => {
      if (waiver) {
        queryClient.setQueryData<Waiver[]>(['waivers', userId], (old) => [...(old ?? []), waiver]);
      } else {
        queryClient.invalidateQueries({ queryKey: ['waivers', userId] });
      }
    },
  });
}

/**
 * Wraps a booking action so it only runs once the account holder has signed
 * their own waiver; otherwise offers to sign it. Parents who only signed for
 * their children reach the app without one. The database enforces the same
 * rule, so an unknown state (still loading) just lets the action through.
 */
export function useRequireAdultWaiver() {
  const { data: waivers } = useMyWaivers();
  const router = useRouter();

  return (action: () => void) => {
    if (waivers && !findAdultWaiver(waivers)) {
      Alert.alert(
        'Sign your waiver',
        'You need to sign the participation waiver for yourself before you can book.',
        [
          { text: 'Not Now', style: 'cancel' },
          { text: 'Sign Now', onPress: () => router.push('/sign-waiver') },
        ],
      );
      return;
    }
    action();
  };
}
