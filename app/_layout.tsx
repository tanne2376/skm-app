import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StripeProvider } from '@stripe/stripe-react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: 1,
    },
  },
});

const stripePublishableKey = Constants.expoConfig?.extra?.stripePublishableKey as string;

function AuthGuard() {
  const { session, isLoading, isPasswordRecovery } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    // Password recovery flow takes priority — send user to set a new password
    if (isPasswordRecovery && session) {
      router.replace('/(auth)/reset-password');
      return;
    }

    const inAuthGroup = segments[0] === '(auth)';
    if (session && inAuthGroup) {
      router.replace('/(app)/home');
    } else if (!session && !inAuthGroup && segments[0] !== undefined) {
      router.replace('/(auth)/login');
    }
  }, [session, isLoading, isPasswordRecovery, segments]);

  return null;
}

/** Extract Supabase auth tokens from a deep link URL and set the session. */
async function handleAuthDeepLink(url: string) {
  // Only process links intended for our app's auth flows
  if (!url.startsWith('skm://')) return;

  // Supabase sends tokens in the URL fragment: skm://...#access_token=...&type=recovery
  const hash = url.split('#')[1];
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type');
  if (!accessToken || !refreshToken) return;

  // Only accept known auth flow types
  if (type !== 'recovery' && type !== 'signup') return;

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    console.error('Failed to set session from deep link:', error.message);
  }
}

export default function RootLayout() {
  useEffect(() => {
    // Handle deep link that opened the app (cold start)
    Linking.getInitialURL()
      .then((url) => {
        if (url) handleAuthDeepLink(url);
      })
      .catch((err) => {
        console.error('Failed to get initial URL:', err);
      });
    // Handle deep link while app is already open (warm start)
    const sub = Linking.addEventListener('url', ({ url }) => handleAuthDeepLink(url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(() => {
      // Deep link handling is done via notification data
    });
    return () => subscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeProvider
          publishableKey={stripePublishableKey ?? ''}
          merchantIdentifier="merchant.com.switchkickmafia.app"
          urlScheme="skm"
        >
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <Stack screenOptions={{ headerShown: false }} />
              <AuthGuard />
            </AuthProvider>
          </QueryClientProvider>
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
