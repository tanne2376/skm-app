import { useRouter } from 'expo-router';
import { useAuth } from './useAuth';

/**
 * Returns a wrapper that runs the action when signed in, or redirects
 * to the login screen when the user is browsing as a guest. Used to
 * gate account-based actions (book, subscribe, cancel, etc.) while
 * keeping the rest of the app browseable per Apple guideline 5.1.1.
 */
export function useRequireAuth() {
  const { session } = useAuth();
  const router = useRouter();
  return (action: () => void) => {
    if (!session) {
      router.push('/(auth)/login');
      return;
    }
    action();
  };
}
