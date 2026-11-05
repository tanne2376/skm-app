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
import { useMyWaivers } from '@/hooks/useWaiver';
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
  const { session, isLoading, isPasswordRecovery, isEmailVerified } = useAuth();
  const waiversQuery = useMyWaivers();
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
    const onVerifyEmail = inAuthGroup && segments[1] === 'verify-email';
    const onWaiver = segments[0] === 'waiver';
    const onSignWaiver = segments[0] === 'sign-waiver';

    // If the user signs out while on verify-email, redirect to login
    if (!session && onVerifyEmail) {
      router.replace('/(auth)/login');
      return;
    }

    // Signed out from a waiver screen: back to guest browsing.
    if (!session && (onWaiver || onSignWaiver)) {
      router.replace('/(app)/home');
      return;
    }

    // Signed in but email not yet verified: keep them on verify-email until they confirm.
    // Edge functions reject unverified users with non-2xx errors; gating here avoids those.
    if (session && !isEmailVerified) {
      if (!onVerifyEmail) router.replace('/(auth)/verify-email');
      return;
    }

    if (session) {
      // Every account needs at least one signed waiver (the holder's own or a
      // child's) before using the app. A failed lookup also lands on the
      // waiver screen, which offers a retry.
      if (waiversQuery.isPending) return;
      if (!waiversQuery.data?.length) {
        if (!onWaiver) router.replace('/waiver');
        return;
      }

      // Signed-in users dropped on a login/register screen go straight to
      // home. The waiver screen leaves by itself once everyone ticked has
      // signed. Guests are free to roam the (app) group — gated actions
      // redirect to login on tap via useRequireAuth.
      if (inAuthGroup) router.replace('/(app)/home');
    }
  }, [session, isLoading, isPasswordRecovery, isEmailVerified, segments, waiversQuery.isPending, waiversQuery.data]);

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
