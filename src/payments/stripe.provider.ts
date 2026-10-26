import { env } from '../config/env';
import { getStripe } from './stripe.client';
import type { PaymentProvider } from './types';

const MINOR_UNITS = 100;

function requireSecret(secret: string | null) {
  if (!secret) throw new Error('Stripe did not return a client secret');
  return secret;
}

export const stripeProvider: PaymentProvider = {
  name: 'stripe',

  async createIntent({ amount, orderId, reservationId, userId }) {
    const intent = await getStripe().paymentIntents.create(
      {
        amount: amount * MINOR_UNITS,
        currency: env.PAYMENT_CURRENCY,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId, reservationId, userId },
      },
      { idempotencyKey: `payment-intent-${orderId}` },
    );
    return { id: intent.id, clientSecret: requireSecret(intent.client_secret) };
  },

  async clientSecretFor(intentId) {
    const intent = await getStripe().paymentIntents.retrieve(intentId);
    return requireSecret(intent.client_secret);
  },

  async cancel(intentId) {
    await getStripe().paymentIntents.cancel(intentId);
  },

  async refund(intentId) {
    await getStripe().refunds.create({ payment_intent: intentId });
  },
};
