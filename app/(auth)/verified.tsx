import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants';
import { Button } from '@/components/ui/Button';

// Landing route for the skm://verified deep link sent by docs/verified.html
// after Supabase email verification. Tokens in the URL fragment are picked up
// asynchronously by handleAuthDeepLink in app/_layout.tsx; once the session is
// set, AuthGuard redirects to /(app)/home automatically (this file lives under
// (auth) so AuthGuard sees inAuthGroup === true and routes accordingly).
export default function VerifiedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowFallback(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <ActivityIndicator color={COLORS.accent} size="large" />
      <Text style={styles.title}>Email verified</Text>
      <Text style={styles.body}>Signing you in…</Text>

      {showFallback && (
        <View style={styles.fallback}>
          <Text style={styles.fallbackBody}>
            Taking longer than expected? You can sign in manually.
          </Text>
          <Button
            variant="secondary"
            size="md"
            onPress={() => router.replace('/(auth)/login')}
          >
            Go to sign in
          </Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.white,
    marginTop: 8,
  },
  body: {
    color: COLORS.grey[300],
    fontSize: 15,
    lineHeight: 22,
  },
  fallback: {
    marginTop: 32,
    gap: 12,
    alignItems: 'center',
  },
  fallbackBody: {
    color: COLORS.grey[400],
    fontSize: 14,
    textAlign: 'center',
  },
});
