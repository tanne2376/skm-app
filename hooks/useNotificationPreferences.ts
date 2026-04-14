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
      // Fetch fresh preferences to avoid stale closure issues during rapid toggles
      const { data: freshProfile } = await supabase
        .from('profiles')
        .select('notification_preferences')
        .eq('id', profile.id)
        .single();
      const current = (freshProfile?.notification_preferences ?? {}) as NotificationPreferences;
      const updated = { ...current, [type]: enabled };
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
