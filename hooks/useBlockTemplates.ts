import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { BlockTemplate } from '@/types';

interface UseBlockTemplatesOpts {
  activeOnly?: boolean;
}

export function useBlockTemplates({ activeOnly = true }: UseBlockTemplatesOpts = {}) {
  return useQuery<BlockTemplate[]>({
    queryKey: ['block_templates', { activeOnly }],
    queryFn: async () => {
      let query = supabase.from('block_templates').select('*').order('price_pence', { ascending: true });
      if (activeOnly) query = query.eq('is_active', true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as BlockTemplate[];
    },
  });
}

interface CreateTemplateInput {
  name: string;
  sessions_count: number;
  validity_days: number | null;
  price_pence: number;
}

export function useCreateBlockTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTemplateInput) => {
      const { error } = await supabase.from('block_templates').insert(input);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['block_templates'] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });
}

export function useUpdateBlockTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<BlockTemplate> }) => {
      const { error } = await supabase.from('block_templates').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['block_templates'] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });
}

export function useDeactivateBlockTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Soft-delete via is_active=false to preserve historical block rows
      // (which reference template_id with on delete restrict).
      const { error } = await supabase.from('block_templates').update({ is_active: false }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['block_templates'] }),
    onError: (e: Error) => Alert.alert('Error', e.message),
  });
}
