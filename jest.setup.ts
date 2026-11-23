// Global test setup
// @testing-library/jest-native v5+ auto-extends expect, no explicit import needed

// Silence specific warnings in tests
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  // Suppress known React Native test environment warnings
  if (
    msg.includes('Warning: An update to') ||
    msg.includes('act(') ||
    msg.includes('ReactDOM.render')
  ) {
    return;
  }
  originalConsoleError(...args);
};

// Public config the app reads from process.env.EXPO_PUBLIC_* (inlined by Expo at build time)
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??= 'pk_test_dummy';
