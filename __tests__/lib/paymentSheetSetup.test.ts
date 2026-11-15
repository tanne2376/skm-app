/**
 * PaymentSheet holds one configuration app-wide, so set-ups must never
 * overlap or finish out of order: the newest checkout's configuration has to
 * be the one left in place.
 */

import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import {
  claimPaymentSheet,
  initializeDeferredPaymentSheet,
  initializePaymentSheet,
  ownsPaymentSheet,
  presentIntentPaymentSheet,
  PAYMENT_SHEET_SUPERSEDED,
} from '../../lib/stripe';

const mockInit = initPaymentSheet as jest.Mock;
const mockPresent = presentPaymentSheet as jest.Mock;

const deferred = (ticket: number, amount: number) => ({
  ticket,
  amount,
  customerId: 'cus_1',
  customerEphemeralKeySecret: 'ek_1',
  confirmHandler: jest.fn(),
});

const intent = (secret: string) => ({
  paymentIntentClientSecret: secret,
  customerEphemeralKeySecret: 'ek_1',
  customerId: 'cus_1',
  amount: 1500,
});

describe('PaymentSheet set-up ordering', () => {
  beforeEach(() => {
    mockInit.mockReset();
    mockInit.mockResolvedValue({ error: null });
  });

  it('runs a newer set-up only after an in-flight one finishes, so the newer one wins', async () => {
    let finishFirst: (v: { error: null }) => void = () => {};
    mockInit.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }));

    const first = initializeDeferredPaymentSheet(deferred(claimPaymentSheet(), 1500));
    await Promise.resolve(); // let the first set-up reach the native call
    await Promise.resolve();
    expect(mockInit).toHaveBeenCalledTimes(1);

    const second = initializePaymentSheet(intent('pi_2_secret_b'));
    await Promise.resolve();
    expect(mockInit).toHaveBeenCalledTimes(1); // waits for the in-flight one

    finishFirst({ error: null });
    await first;
    await second;

    expect(mockInit).toHaveBeenCalledTimes(2);
    expect(mockInit.mock.calls[1][0]).toEqual(expect.objectContaining({ paymentIntentClientSecret: 'pi_2_secret_b' }));
  });

  it('skips a queued set-up that a newer checkout superseded before it ran', async () => {
    const staleTicket = claimPaymentSheet();
    const freshTicket = claimPaymentSheet();

    await expect(initializeDeferredPaymentSheet(deferred(staleTicket, 1500)))
      .rejects.toThrow(PAYMENT_SHEET_SUPERSEDED);
    await initializeDeferredPaymentSheet(deferred(freshTicket, 2000));

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][0].intentConfiguration.mode.amount).toBe(2000);
    expect(ownsPaymentSheet(freshTicket)).toBe(true);
  });

  it('surfaces a native set-up error without blocking later set-ups', async () => {
    mockInit.mockResolvedValueOnce({ error: { message: 'Invalid ephemeral key' } });

    await expect(initializePaymentSheet(intent('pi_1_secret_a'))).rejects.toThrow('Invalid ephemeral key');
    await expect(initializePaymentSheet(intent('pi_2_secret_b'))).resolves.toBeUndefined();
  });

  describe('presentIntentPaymentSheet', () => {
    beforeEach(() => mockPresent.mockClear());

    it('reports a set-up failure as a failed payment without presenting', async () => {
      mockInit.mockResolvedValueOnce({ error: { message: 'Invalid ephemeral key' } });

      const result = await presentIntentPaymentSheet(intent('pi_1_secret_a'));

      expect(result).toEqual({ success: false, error: 'Invalid ephemeral key' });
      expect(mockPresent).not.toHaveBeenCalled();
    });

    it('presents the sheet once set up', async () => {
      mockPresent.mockResolvedValueOnce({ error: undefined });

      const result = await presentIntentPaymentSheet(intent('pi_1_secret_a'));

      expect(mockPresent).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });
  });
});
