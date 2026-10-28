import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { COLORS } from '@/constants';

export interface PaymentSheetParams {
  paymentIntentClientSecret: string;
  customerEphemeralKeySecret: string;
  customerId: string;
  amount: number; // pence
  currency?: string;
  merchantDisplayName?: string;
}

export async function initializePaymentSheet(params: PaymentSheetParams): Promise<void> {
  const { error } = await initPaymentSheet({
    paymentIntentClientSecret: params.paymentIntentClientSecret,
    customerEphemeralKeySecret: params.customerEphemeralKeySecret,
    customerId: params.customerId,
    merchantDisplayName: params.merchantDisplayName ?? 'Switch-Kick Mafia',
    // Required for redirect-based payment methods (Klarna, Bancontact, iDEAL, etc.)
    // to return to the app after the bank/wallet flow completes. App scheme set
    // in app.config.ts.
    returnURL: 'skm://stripe-redirect',
    applePay: {
      merchantCountryCode: 'GB',
    },
    googlePay: {
      merchantCountryCode: 'GB',
      testEnv: __DEV__,
      currencyCode: params.currency ?? 'gbp',
    },
    defaultBillingDetails: {
      address: {
        country: 'GB',
      },
    },
    style: 'alwaysDark',
    appearance: {
      colors: {
        primary: COLORS.accent,
        background: COLORS.black,
        componentBackground: COLORS.grey[900],
        componentBorder: COLORS.grey[800],
        componentDivider: COLORS.grey[800],
        primaryText: COLORS.white,
        secondaryText: COLORS.grey[400],
        componentText: COLORS.white,
        placeholderText: COLORS.grey[600],
        icon: COLORS.grey[400],
        error: COLORS.error,
      },
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}

export const PAYMENT_CANCELED = '__payment_canceled__';

export async function openPaymentSheet(): Promise<{ success: boolean; canceled?: boolean; error?: string }> {
  const { error } = await presentPaymentSheet();
  if (error) {
    return {
      success: false,
      canceled: error.code === 'Canceled',
      error: error.message,
    };
  }
  return { success: true };
}

/** Format pence to GBP display string, e.g. 1500 → "£15.00" */
export function formatGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
