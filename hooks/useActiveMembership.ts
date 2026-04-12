import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { MembershipWithUsage } from '@/types';
import { membershipWeekStart } from '@/lib/membershipWeek';
import { useAuth } from './useAuth';

export function useActiveMembership() {
  const { session } = useAuth();
  const weekStart = membershipWeekStart();

  return useQuery<MembershipWithUsage | null>({
    queryKey: ['membership', session?.user.id, weekStart],
    enabled: !!session,
    queryFn: async () => {
      const { data: membership, error } = await supabase
        .from('memberships')
        .select('*')
        .eq('student_id', session!.user.id)
        .in('status', ['active', 'cancelling', 'past_due'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!membership) return null;

      let weeklyUsageCount = 0;
      if (membership.tier === 'two_per_week') {
        const ws = membershipWeekStart();
        const { count, error: usageError } = await supabase
          .from('membership_weekly_usage')
          .select('id', { count: 'exact', head: true })
          .eq('membership_id', membership.id)
          .eq('week_start', ws);
        if (usageError) throw usageError;
        weeklyUsageCount = count ?? 0;
      }

      return { ...membership, weekly_usage_count: weeklyUsageCount } as MembershipWithUsage;
    },
  });
}
