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
    // Append a per-mount random suffix so each invocation owns a distinct
    // channel. supabase-js keeps a channels registry keyed by topic, and
    // removeChannel is async — under StrictMode double-effects or fast
    // navigation, the previous channel can still be present and already
    // .subscribe()d when the next mount runs, which makes .on() throw
    // "cannot add postgres_changes callbacks after subscribe()". A unique
    // name per mount sidesteps the collision entirely.
    const uniqueName = `${channelName}-${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase.channel(uniqueName);

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
