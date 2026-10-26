import { env } from '../config/env';
import { getStripe } from './stripe.client';
import type { PaymentProvider } from './types';

const MINOR_UNITS = 100;

export const stripeProvider: PaymentProvider = {
  name: 'stripe',

  async createSession(input) {
    const metadata = {
      orderId: input.orderId,
      reservationId: input.reservationId,
      dropId: input.dropId,
      userId: input.userId,
    };

    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: input.orderId,
        customer_email: input.customerEmail,
        line_items: [
          {
            quantity: input.quantity,
            price_data: {
              currency: env.PAYMENT_CURRENCY,
              unit_amount: input.unitAmount * MINOR_UNITS,
              product_data: {
                name: input.productName,
                ...(input.productImageUrl
                  ? { images: [input.productImageUrl] }
                  : {}),
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: input.expiresAt,
      },
      { idempotencyKey: `checkout-session-${input.orderId}` },
    );

    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { id: session.id, url: session.url };
  },

  async urlFor(sessionId) {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    return session.status === 'open' ? session.url : null;
  },

  async cancel(sessionId) {
    await getStripe().checkout.sessions.expire(sessionId);
  },

  async refund(paymentIntentId) {
    await getStripe().refunds.create({ payment_intent: paymentIntentId });
  },
};
