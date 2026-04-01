export const COLORS = {
  black: '#0A0A0A',
  white: '#FFFFFF',
  accent: '#C8102E',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  grey: {
    50: '#F9F9F9',
    100: '#F0F0F0',
    200: '#E0E0E0',
    300: '#BDBDBD',
    400: '#9E9E9E',
    600: '#5E5E5E',
    700: '#424242',
    800: '#2E2E2E',
    900: '#1A1A1A',
  },
} as const;

export const CANCELLATION_WINDOW_HOURS = 3;
export const SESSION_GENERATION_WEEKS_AHEAD = 4;

// Prices in pence (GBP)
export const DEFAULT_CLASS_PRICE_PENCE = 1500; // £15.00
export const MEMBERSHIP_PRICES_PENCE = {
  two_per_week: 8000, // £80.00/mo
  unlimited: 10000,   // £100.00/mo
} as const;

// Day of week using ISODOW (1=Monday ... 7=Sunday)
export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
