import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';

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
        primary: '#C8102E',
        background: '#0A0A0A',
        componentBackground: '#1A1A1A',
        componentBorder: '#2E2E2E',
        componentDivider: '#2E2E2E',
        primaryText: '#FFFFFF',
        secondaryText: '#9E9E9E',
        componentText: '#FFFFFF',
        placeholderText: '#5E5E5E',
        icon: '#9E9E9E',
        error: '#EF4444',
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
