// Palette sampled from the Scrapyard timetable: charcoal headers, orange and
// olive class blocks, with peach / pale-olive tints.
export const COLORS = {
  black: '#2B2B2B',     // app background — dark charcoal
  white: '#FFFFFF',
  accent: '#F26000',    // Scrapyard orange
  accentTint: 'rgba(242,96,0,0.12)',
  olive: '#6B6B38',
  oliveLight: '#BEC498',
  peach: '#FEC8A6',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  grey: {
    50: '#F9F9F9',
    100: '#F0F0F0',
    200: '#E0E0E0',
    300: '#D4D4D8',
    400: '#B0B0B0',
    500: '#9A9A9A',
    600: '#8A8A8A',
    700: '#5A5A5A',
    800: '#3A3A3A',
    900: '#1C1C1C',     // cards / tab bar — sit darker than the charcoal background
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
