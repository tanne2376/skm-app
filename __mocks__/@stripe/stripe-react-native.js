// Mock for @stripe/stripe-react-native in Jest (no native binary available)
module.exports = {
  StripeProvider: ({ children }) => children,
  useStripe: () => ({
    initPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
    presentPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
    confirmPayment: jest.fn().mockResolvedValue({ paymentIntent: null, error: null }),
  }),
  initPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
  presentPaymentSheet: jest.fn().mockResolvedValue({ error: null }),
  createPaymentMethod: jest.fn().mockResolvedValue({ paymentMethod: null, error: null }),
};
