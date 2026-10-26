import { env } from '../config/env';
import { mockProvider } from './mock.provider';
import { stripeProvider } from './stripe.provider';
import type { PaymentProvider } from './types';

export const paymentProvider: PaymentProvider =
  env.PAYMENT_PROVIDER === 'stripe' ? stripeProvider : mockProvider;
