import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ClassSessionWithDetails } from '@/types';
import { useAuth } from './useAuth';

export function useClassSessions(from: Date, to: Date) {
  const { session } = useAuth();

  return useQuery<ClassSessionWithDetails[]>({
    queryKey: ['class_sessions', from.toISOString().split('T')[0], to.toISOString().split('T')[0]],
    enabled: !!session,
    queryFn: async () => {
      const fromDate = from.toISOString().split('T')[0];
      const toDate = to.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('class_sessions')
        .select(`
          *,
          class_templates (*),
          teacher:profiles!teacher_id (id, full_name),
          bookings (id, student_id, status, payment_method, payment_status,
                    stripe_payment_intent_id, waitlist_position, booked_at, cancelled_at)
        `)
        .gte('session_date', fromDate)
        .lte('session_date', toDate)
        .eq('is_cancelled', false)
        .order('session_date', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;

      const sessionIds = (data ?? []).map((s: any) => s.id);

      // Accurate booking counts via security-definer function (bypasses per-user RLS)
      const { data: stats } = sessionIds.length > 0
        ? await supabase.rpc('get_session_booking_stats', { p_session_ids: sessionIds })
        : { data: [] };

      const statsMap = new Map<string, { confirmed_count: number; waitlist_count: number }>(
        (stats ?? []).map((s: any) => [s.session_id, s]),
      );

      const userId = session!.user.id;

      return (data ?? []).map((s: any) => {
        const allBookings = s.bookings ?? [];
        const userBooking = allBookings.find((b: any) => b.student_id === userId);
        const stat = statsMap.get(s.id);
        const effectiveCapacity = s.capacity ?? s.class_templates?.capacity ?? 20;
        const effectivePrice = s.price ?? s.class_templates?.price ?? 1500;

        return {
          ...s,
          confirmed_count: stat?.confirmed_count ?? 0,
          waitlist_count: stat?.waitlist_count ?? 0,
          user_booking: userBooking,
          effective_capacity: effectiveCapacity,
          effective_price: effectivePrice,
        } as ClassSessionWithDetails;
      });
    },
  });
}

// 7-day window so there are always sessions visible regardless of day of week
export function useUpcomingSessions() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return useClassSessions(now, in7Days);
}

/** @deprecated use useUpcomingSessions */
export function useNext24HoursSessions() {
  return useUpcomingSessions();
}
