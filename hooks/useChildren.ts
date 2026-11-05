import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Child, NewChild } from '@/types';
import { useAuth } from './useAuth';

/** Children on the signed-in account, oldest-added first. */
export function useChildren() {
  const { session, isEmailVerified } = useAuth();
  const userId = session?.user.id;

  return useQuery<Child[]>({
    queryKey: ['children', userId],
    enabled: !!userId && isEmailVerified,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('children')
        .select('*')
        .eq('parent_id', userId!)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useAddChild() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  return useMutation({
    mutationFn: async (child: NewChild) => {
      const { data, error } = await supabase
        .from('children')
        .insert({ ...child, parent_id: userId! })
        .select('*')
        .single();
      if (error) throw error;
      return data as Child;
    },
    onSuccess: (child) => {
      queryClient.setQueryData<Child[]>(['children', userId], (old) => [...(old ?? []), child]);
    },
  });
}

export function useRemoveChild() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const userId = session?.user.id;

  return useMutation({
    mutationFn: async (childId: string) => {
      const { error } = await supabase.from('children').delete().eq('id', childId);
      // waivers.child_id references the child: signed records are kept.
      if (error?.code === '23503') {
        throw new Error('This child has a signed waiver, so they can’t be removed. Please contact the gym.');
      }
      if (error) throw error;
    },
    onSuccess: (_, childId) => {
      queryClient.setQueryData<Child[]>(['children', userId], (old) => old?.filter((c) => c.id !== childId));
    },
  });
}
