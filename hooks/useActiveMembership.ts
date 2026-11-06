import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Membership, MembershipWithUsage } from '@/types';
import { membershipWeekStart } from '@/lib/membershipWeek';
import { useAuth } from './useAuth';

/** The account holder's own (adult) membership. Kids memberships: useKidsMemberships. */
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
        .is('child_id', null)
        .in('status', ['active', 'cancelling', 'past_due'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!membership) return null;

      let weeklyUsageCount = 0;
      if (membership.tier === 'two_per_week') {
        const { count, error: usageError } = await supabase
          .from('membership_weekly_usage')
          .select('id', { count: 'exact', head: true })
          .eq('membership_id', membership.id)
          .eq('week_start', weekStart);
        if (usageError) throw usageError;
        weeklyUsageCount = count ?? 0;
      }

      return withCashGrace(membership, weeklyUsageCount);
    },
  });
}

/**
 * Kids memberships on the account, newest first: at most one live
 * membership per child. Each covers unlimited kids classes for that child.
 */
export function useKidsMemberships() {
  const { session } = useAuth();

  return useQuery<MembershipWithUsage[]>({
    queryKey: ['membership', 'kids', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*')
        .eq('student_id', session!.user.id)
        .not('child_id', 'is', null)
        .in('status', ['active', 'cancelling', 'past_due'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Membership[]).map((m) => withCashGrace(m, 0));
    },
  });
}

/** Can this membership book a class right now? (Quota aside.) */
export function isMembershipUsable(m: MembershipWithUsage | null | undefined): boolean {
  return !!m && (m.status === 'active' || m.status === 'cancelling') && !m.cash_grace_expired;
}

// Cash memberships must be confirmed within 72 hours of starting.
function withCashGrace(membership: Membership, weeklyUsageCount: number): MembershipWithUsage {
  let cashGraceExpiresAt: string | null = null;
  let cashGraceExpired = false;
  if (membership.payment_method === 'cash' && membership.payment_status === 'pending') {
    const created = new Date(membership.created_at);
    const expiry = new Date(created.getTime() + 72 * 60 * 60 * 1000);
    cashGraceExpiresAt = expiry.toISOString();
    cashGraceExpired = expiry.getTime() <= Date.now();
  }

  return {
    ...membership,
    weekly_usage_count: weeklyUsageCount,
    cash_grace_expires_at: cashGraceExpiresAt,
    cash_grace_expired: cashGraceExpired,
  };
}
