import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth, EMAIL_VERIFICATION_REDIRECT_URL } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? '';

  const [resending, setResending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Refresh on mount and on every transition back to the foreground —
  // covers the user verifying on this device (deep link returns control
  // to the app) or on another device (they swipe back to SKM manually).
  useEffect(() => {
    supabase.auth.refreshSession();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.refreshSession();
    });
    return () => sub.remove();
  }, []);

  async function handleResend() {
    if (!email) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: EMAIL_VERIFICATION_REDIRECT_URL },
    });
    setResending(false);
    if (error) {
      Alert.alert('Could not resend', error.message);
      return;
    }
    Alert.alert('Sent', `We've sent another verification link to ${email}.`);
  }

  async function handleRefresh() {
    setRefreshing(true);
    const { data, error } = await supabase.auth.refreshSession();
    setRefreshing(false);
    if (error) {
      Alert.alert('Could not refresh', error.message);
      return;
    }
    if (!data.session?.user?.email_confirmed_at) {
      Alert.alert(
        'Still unverified',
        'We can’t see a verification yet. Open the link in your email, then try again.',
      );
    }
    // If verified, AuthGuard will redirect onto the main tabs automatically.
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.title}>Verify your email</Text>

      <Card>
        <Text style={styles.body}>
          We sent a verification link to:
        </Text>
        <Text style={styles.email}>{email || 'your email address'}</Text>
        <Text style={[styles.body, { marginTop: 12 }]}>
          Tap the link in that email, then come back and press <Text style={styles.bold}>I&apos;ve verified</Text>.
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button
          variant="primary"
          size="lg"
          onPress={handleRefresh}
          loading={refreshing}
        >
          I&apos;ve verified
        </Button>
        <Button
          variant="secondary"
          size="md"
          onPress={handleResend}
          loading={resending}
        >
          Resend verification email
        </Button>
        <Button
          variant="danger"
          size="md"
          onPress={signOut}
        >
          Sign out
        </Button>
      </View>

      {(resending || refreshing) && (
        <ActivityIndicator style={{ marginTop: 12 }} color={COLORS.grey[400]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
    paddingHorizontal: 24,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: 8,
  },
  body: {
    color: COLORS.grey[300],
    fontSize: 15,
    lineHeight: 22,
  },
  email: {
    color: COLORS.white,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 6,
  },
  bold: {
    color: COLORS.white,
    fontWeight: '700',
  },
  actions: {
    gap: 12,
    marginTop: 8,
  },
});
