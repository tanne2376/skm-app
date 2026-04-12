import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { MembershipWithUsage } from '@/types';
import { useAuth } from './useAuth';

/** Returns the Monday of the ISO week for a given date */
function isoWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust to Monday
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

export function useActiveMembership() {
  const { session } = useAuth();

  return useQuery<MembershipWithUsage | null>({
    queryKey: ['membership', session?.user.id],
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
        const weekStart = isoWeekStart(new Date());
        const { count, error: usageError } = await supabase
          .from('membership_weekly_usage')
          .select('id', { count: 'exact', head: true })
          .eq('membership_id', membership.id)
          .eq('week_start', weekStart);
        if (usageError) throw usageError;
        weeklyUsageCount = count ?? 0;
      }

      return { ...membership, weekly_usage_count: weeklyUsageCount } as MembershipWithUsage;
    },
  });
}
