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
