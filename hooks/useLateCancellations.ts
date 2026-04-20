import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

export function useBookingBlocked() {
  const { session } = useAuth();

  return useQuery<{ blocked: boolean; count: number }>({
    queryKey: ['late_cancellation_block', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const userId = session!.user.id;

      const [{ data: isBlocked, error: blockedError }, { data: count, error: countError }] = await Promise.all([
        supabase.rpc('is_user_booking_blocked', { p_user_id: userId }),
        supabase.rpc('get_late_cancellation_count', { p_user_id: userId }),
      ]);
      if (blockedError) throw blockedError;
      if (countError) throw countError;

      return { blocked: isBlocked ?? false, count: count ?? 0 };
    },
  });
}
