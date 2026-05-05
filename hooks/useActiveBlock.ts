import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { deriveBlockState } from '@/lib/blockState';
import { Block, BlockWithDerived } from '@/types';
import { useAuth } from './useAuth';

export function useActiveBlock() {
  const { session } = useAuth();

  return useQuery<BlockWithDerived | null>({
    queryKey: ['block', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocks')
        .select('*')
        .eq('student_id', session!.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return deriveBlockState(data as Block);
    },
  });
}
