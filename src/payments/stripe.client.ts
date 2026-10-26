import Stripe from 'stripe';
import { env } from '../config/env';

let client: Stripe | null = null;

export function getStripe() {
  if (!env.STRIPE_SECRET_KEY)
    throw new Error('STRIPE_SECRET_KEY is not configured');
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}
