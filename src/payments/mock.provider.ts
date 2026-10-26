import { env } from '../config/env';
import type { PaymentProvider } from './types';

const PREFIX = 'mock_cs_';

const mockUrl = (sessionId: string) =>
  `${env.CLIENT_ORIGIN}/checkout/mock/${sessionId.slice(PREFIX.length)}`;

export const mockProvider: PaymentProvider = {
  name: 'mock',

  async createSession({ orderId }) {
    const id = `${PREFIX}${orderId}`;
    return { id, url: mockUrl(id) };
  },

  async urlFor(sessionId) {
    return mockUrl(sessionId);
  },

  async cancel() {
    return;
  },

  async refund() {
    return;
  },
};
