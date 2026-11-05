import { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COLORS } from '@/constants';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { WaiverForm } from '@/components/WaiverForm';
import { useAuth } from '@/hooks/useAuth';
import { useChildren } from '@/hooks/useChildren';
import { useMyWaivers } from '@/hooks/useWaiver';
import { findAdultWaiver, findChildWaiver } from '@/lib/waiver';

/**
 * Sign one waiver after onboarding: the account holder's own (no params, e.g.
 * from the booking prompt) or a child's (`?childId=`, from Settings → Family).
 */
export default function SignWaiverScreen() {
  const { childId } = useLocalSearchParams<{ childId?: string }>();
  const { profile } = useAuth();
  const waiversQuery = useMyWaivers();
  const childrenQuery = useChildren();
  // Set on success so the "already signed" message doesn't flash while leaving.
  const [done, setDone] = useState(false);

  const loading = waiversQuery.isPending || (!!childId && childrenQuery.isPending);
  const child = childId ? childrenQuery.data?.find((c) => c.id === childId) : null;
  const alreadySigned = waiversQuery.data
    ? !!(childId ? findChildWaiver(waiversQuery.data, childId) : findAdultWaiver(waiversQuery.data))
    : false;

  let message: string | null = null;
  if (waiversQuery.isError || (childId && childrenQuery.isError)) message = 'We couldn’t load your waivers. Check your connection and try again.';
  else if (!loading && childId && !child) message = 'Child not found on this account.';
  else if (!loading && alreadySigned && !done) message = 'This waiver has already been signed.';

  return (
    <View style={styles.container}>
      <ScreenHeader title={child ? `Waiver: ${child.full_name}` : 'Your Waiver'} showBack />
      {done ? null : loading || message ? (
        <View style={styles.centered}>
          {message ? <Text style={styles.muted}>{message}</Text> : <ActivityIndicator color={COLORS.accent} size="large" />}
        </View>
      ) : (
        <WaiverForm
          child={child ?? null}
          signerName={profile?.full_name ?? ''}
          onSigned={() => {
            setDone(true);
            router.back();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { color: COLORS.grey[400], fontSize: 15, textAlign: 'center' },
});
