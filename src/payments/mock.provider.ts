import type { PaymentProvider } from './types';

const intentFor = (orderId: string) => `mock_pi_${orderId}`;
const secretFor = (intentId: string) =>
  `mock_secret_${intentId.replace('mock_pi_', '')}`;

export const mockProvider: PaymentProvider = {
  name: 'mock',

  async createIntent({ orderId }) {
    const id = intentFor(orderId);
    return { id, clientSecret: secretFor(id) };
  },

  async clientSecretFor(intentId) {
    return secretFor(intentId);
  },

  async cancel() {
    return;
  },

  async refund() {
    return;
  },
};
