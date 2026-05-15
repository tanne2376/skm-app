import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Returns the full_name of the admin who runs un-delegated classes — the
// final fallback for getClassLeaderName when a session has no teacher and
// its template has no teacher. Single-admin clubs hit this almost always;
// multi-admin support is tracked in issue #23 ("flag and address separately").
// Picks the earliest-created admin so the result is deterministic.
export function useDefaultClassLeaderName() {
  return useQuery<string | null>({
    queryKey: ['default_class_leader_name'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('role', 'admin')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.full_name ?? null;
    },
  });
}
