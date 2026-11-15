/**
 * Deferred-intent card checkout for classes: the PaymentSheet is set up
 * before anything is booked, and the PaymentIntent (plus pending booking) is
 * only created when the user presses Pay inside the sheet.
 */

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
  invokeFunction: jest.fn(),
}));

jest.mock('../../lib/stripe', () => {
  let ticket = 0;
  const ownsPaymentSheet = (t: number) => t === ticket;
  return {
    claimPaymentSheet: jest.fn(() => ++ticket),
    ownsPaymentSheet,
    initializePaymentSheet: jest.fn(),
    // Mirrors the real guard: a superseded set-up is skipped.
    initializeDeferredPaymentSheet: jest.fn(async ({ ticket: t }: { ticket: number }) => {
      if (!ownsPaymentSheet(t)) throw new Error('__payment_sheet_superseded__');
    }),
    openPaymentSheet: jest.fn(),
    PAYMENT_CANCELED: '__payment_canceled__',
    PAYMENT_SHEET_SUPERSEDED: '__payment_sheet_superseded__',
  };
});

jest.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'test-anon-key' } } },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import { prepareClassCardPayment } from '../../hooks/useBookSession';
import { supabase, invokeFunction } from '../../lib/supabase';
import { claimPaymentSheet, initializeDeferredPaymentSheet } from '../../lib/stripe';
import { ClassSessionWithDetails } from '../../types';

const mockInvoke = invokeFunction as jest.Mock;
const mockInitDeferred = initializeDeferredPaymentSheet as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

const session = { id: 'session-1', effective_price: 1500 } as ClassSessionWithDetails;

function mockBookingsUpdate(error: { message: string } | null = null) {
  const eq = jest.fn().mockResolvedValue({ error });
  const update = jest.fn(() => ({ eq }));
  mockFrom.mockReturnValue({ update });
  return { update, eq };
}

async function prepareAndGetConfirmHandler() {
  mockInvoke.mockResolvedValueOnce({ data: { customerId: 'cus_1', ephemeralKeySecret: 'ek_1' }, error: null });
  const prepared = prepareClassCardPayment(session);
  await prepared.ready;
  const { confirmHandler } = mockInitDeferred.mock.calls.at(-1)[0];
  return { prepared, confirmHandler };
}

function pressPay(confirmHandler: Function, save: boolean) {
  return new Promise<any>((resolve) => confirmHandler({}, save, resolve));
}

describe('prepareClassCardPayment', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInitDeferred.mockClear();
    mockFrom.mockReset();
  });

  it('sets up the sheet with the customer and class price, without creating a payment', async () => {
    const { prepared } = await prepareAndGetConfirmHandler();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('payment-sheet-customer');
    expect(mockInitDeferred).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cus_1',
      customerEphemeralKeySecret: 'ek_1',
      amount: 1500,
    }));
    expect(prepared.paymentIntentId).toBeNull();
  });

  it('creates the PaymentIntent when the user presses Pay', async () => {
    const { prepared, confirmHandler } = await prepareAndGetConfirmHandler();
    mockInvoke.mockResolvedValueOnce({ data: { clientSecret: 'pi_1_secret_a' }, error: null });

    const result = await pressPay(confirmHandler, true);

    expect(mockInvoke).toHaveBeenLastCalledWith('create-payment-intent', {
      type: 'class', id: 'session-1', deferred: true, savePaymentMethod: true, expectedAmount: 1500,
    });
    expect(result).toEqual({ clientSecret: 'pi_1_secret_a' });
    expect(prepared.paymentIntentId).toBe('pi_1');
  });

  it('never reuses an intent: a second Pay press frees the old booking and makes a new intent', async () => {
    const { prepared, confirmHandler } = await prepareAndGetConfirmHandler();
    const { update, eq } = mockBookingsUpdate();
    mockInvoke
      .mockResolvedValueOnce({ data: { clientSecret: 'pi_1_secret_a' }, error: null })
      .mockResolvedValueOnce({ data: { clientSecret: 'pi_2_secret_b' }, error: null });

    await pressPay(confirmHandler, false);
    const retry = await pressPay(confirmHandler, false);

    expect(mockFrom).toHaveBeenCalledWith('bookings');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(eq).toHaveBeenCalledWith('stripe_payment_intent_id', 'pi_1');
    expect(retry).toEqual({ clientSecret: 'pi_2_secret_b' });
    expect(prepared.paymentIntentId).toBe('pi_2');
  });

  it('does not fall back to a cancelled intent when its replacement fails', async () => {
    const { prepared, confirmHandler } = await prepareAndGetConfirmHandler();
    mockBookingsUpdate();
    mockInvoke
      .mockResolvedValueOnce({ data: { clientSecret: 'pi_1_secret_a' }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('Network error') })
      .mockResolvedValueOnce({ data: { clientSecret: 'pi_3_secret_c' }, error: null });

    await pressPay(confirmHandler, false);
    const failed = await pressPay(confirmHandler, true);
    expect(failed.error.message).toBe('Network error');
    expect(prepared.paymentIntentId).toBeNull();

    const third = await pressPay(confirmHandler, false);
    expect(third).toEqual({ clientSecret: 'pi_3_secret_c' });
    expect(mockInvoke.mock.calls.filter(([name]) => name === 'create-payment-intent')).toHaveLength(3);
  });

  it('stops and shows the error if the old pending booking cannot be cancelled', async () => {
    const { prepared, confirmHandler } = await prepareAndGetConfirmHandler();
    mockBookingsUpdate({ message: 'permission denied' });
    mockInvoke.mockResolvedValueOnce({ data: { clientSecret: 'pi_1_secret_a' }, error: null });

    await pressPay(confirmHandler, false);
    const retry = await pressPay(confirmHandler, false);

    expect(retry.error.message).toBe('permission denied');
    expect(prepared.paymentIntentId).toBe('pi_1');
    expect(mockInvoke.mock.calls.filter(([name]) => name === 'create-payment-intent')).toHaveLength(1);
  });

  it('skips a set-up that another checkout has superseded', async () => {
    let releaseCustomer: (v: unknown) => void = () => {};
    mockInvoke.mockReturnValueOnce(new Promise((resolve) => { releaseCustomer = resolve; }));
    const stale = prepareClassCardPayment(session);

    claimPaymentSheet(); // e.g. a membership checkout initialises the sheet meanwhile
    releaseCustomer({ data: { customerId: 'cus_1', ephemeralKeySecret: 'ek_1' }, error: null });

    await expect(stale.ready).rejects.toThrow('__payment_sheet_superseded__');
  });

  it('shows the server error in the sheet when the intent cannot be created', async () => {
    const { prepared, confirmHandler } = await prepareAndGetConfirmHandler();
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('Class is full') });

    const result = await pressPay(confirmHandler, false);

    expect(result).toEqual({ error: { code: 'Failed', message: 'Class is full', localizedMessage: 'Class is full' } });
    expect(prepared.paymentIntentId).toBeNull();
  });

  it('rejects ready when the customer cannot be loaded', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('Not authenticated. Please sign in again.') });

    await expect(prepareClassCardPayment(session).ready).rejects.toThrow('Not authenticated');
    expect(mockInitDeferred).not.toHaveBeenCalled();
  });
});
