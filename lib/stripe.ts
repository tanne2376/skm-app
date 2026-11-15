import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import type { IntentConfiguration } from '@stripe/stripe-react-native';
import { COLORS } from '@/constants';

export interface PaymentSheetParams {
  paymentIntentClientSecret: string;
  customerEphemeralKeySecret: string;
  customerId: string;
  amount: number; // pence
  currency?: string;
  merchantDisplayName?: string;
}

// PaymentSheet holds one configuration app-wide. Each set-up takes a ticket;
// only the newest ticket's configuration is current, so a slow set-up that
// finishes late can tell it has been superseded instead of overwriting.
let sheetTicket = 0;

/** Reserve the PaymentSheet for a new set-up. */
export function claimPaymentSheet(): number {
  return ++sheetTicket;
}

/** Whether `ticket` is still the most recent PaymentSheet set-up. */
export function ownsPaymentSheet(ticket: number): boolean {
  return ticket === sheetTicket;
}

// Shared PaymentSheet look and wallet setup.
function sheetOptions(params: { currency?: string; merchantDisplayName?: string }) {
  return {
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
    style: 'alwaysDark' as const,
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
  };
}

export async function initializePaymentSheet(params: PaymentSheetParams): Promise<void> {
  claimPaymentSheet();
  const { error } = await initPaymentSheet({
    ...sheetOptions(params),
    paymentIntentClientSecret: params.paymentIntentClientSecret,
    customerEphemeralKeySecret: params.customerEphemeralKeySecret,
    customerId: params.customerId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export interface DeferredPaymentSheetParams {
  /** From claimPaymentSheet(); the set-up is skipped if a newer one has started. */
  ticket: number;
  customerEphemeralKeySecret: string;
  customerId: string;
  amount: number; // pence
  currency?: string;
  merchantDisplayName?: string;
  /** Called when the user presses Pay: create the PaymentIntent and hand back its client secret. */
  confirmHandler: NonNullable<IntentConfiguration['confirmHandler']>;
}

/**
 * Set up PaymentSheet before a PaymentIntent exists (Stripe's deferred-intent
 * flow), so it can open instantly. The intent is created in `confirmHandler`.
 */
export async function initializeDeferredPaymentSheet(params: DeferredPaymentSheetParams): Promise<void> {
  if (!ownsPaymentSheet(params.ticket)) throw new Error(PAYMENT_SHEET_SUPERSEDED);
  const { error } = await initPaymentSheet({
    ...sheetOptions(params),
    customerEphemeralKeySecret: params.customerEphemeralKeySecret,
    customerId: params.customerId,
    intentConfiguration: {
      mode: { amount: params.amount, currencyCode: (params.currency ?? 'gbp').toUpperCase() },
      confirmHandler: params.confirmHandler,
    },
  });

  if (error) {
    throw new Error(error.message);
  }
}

export const PAYMENT_CANCELED = '__payment_canceled__';
export const PAYMENT_SHEET_SUPERSEDED = '__payment_sheet_superseded__';

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
