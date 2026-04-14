import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { supabase } from '@/lib/supabase';
import { NotificationPreferences, NotificationType } from '@/types';

export function useNotificationPreferences() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const preferences: NotificationPreferences = profile?.notification_preferences ?? {};

  function isEnabled(type: NotificationType): boolean {
    return preferences[type] !== false; // missing = enabled (opt-out model)
  }

  const toggle = useMutation({
    mutationFn: async ({ type, enabled }: { type: NotificationType; enabled: boolean }) => {
      if (!profile) throw new Error('Not authenticated');
      const updated = { ...preferences, [type]: enabled };
      const { error } = await supabase
        .from('profiles')
        .update({ notification_preferences: updated })
        .eq('id', profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  return { preferences, isEnabled, toggle };
}
