import { Request, Response } from 'express';
import type Stripe from 'stripe';
import { env } from '../config/env';
import { getStripe } from '../payments/stripe.client';
import { handleStripeEvent } from '../services/payment.service';

export async function stripeWebhook(req: Request, res: Response) {
  const signature = req.headers['stripe-signature'];

  if (
    env.PAYMENT_PROVIDER !== 'stripe' ||
    !env.STRIPE_WEBHOOK_SECRET ||
    typeof signature !== 'string'
  ) {
    res
      .status(400)
      .json({ error: 'Webhook is not available', code: 'WEBHOOK_UNAVAILABLE' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    res.status(400).json({ error: 'Invalid signature', code: 'BAD_SIGNATURE' });
    return;
  }

  await handleStripeEvent(event);
  res.json({ received: true });
}
