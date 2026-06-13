import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Subscribe to Postgres changes on a table and invalidate a TanStack Query key on any change */
export function useRealtimeInvalidate(
  channelName: string,
  table: string,
  filter: string | undefined,
  queryKey: unknown[],
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // supabase-js caches channels by name in a global registry. After a
    // fast remount (e.g. navigating home → login → home), the prior channel
    // may still be in the registry with .subscribe() already called, and
    // .on() would throw "cannot add postgres_changes callbacks after
    // subscribe()". Drain any leftover before creating a fresh one.
    const stale = supabase
      .getChannels()
      .find((c) => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase.channel(channelName);

    const config: Parameters<typeof channel.on>[1] = {
      event: '*',
      schema: 'public',
      table,
      ...(filter ? { filter } : {}),
    };

    channel
      .on('postgres_changes', config as any, () => {
        queryClient.invalidateQueries({ queryKey });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, table, filter, queryClient, queryKey.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
}
