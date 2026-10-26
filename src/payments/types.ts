export interface CreateSessionInput {
  orderId: string;
  reservationId: string;
  dropId: string;
  userId: string;
  customerEmail?: string;
  productName: string;
  productImageUrl?: string;
  quantity: number;
  unitAmount: number;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number;
}

export interface PaymentSessionRef {
  id: string;
  url: string;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'mock';
  createSession(input: CreateSessionInput): Promise<PaymentSessionRef>;
  urlFor(sessionId: string): Promise<string | null>;
  cancel(sessionId: string): Promise<void>;
  refund(paymentIntentId: string): Promise<void>;
}
