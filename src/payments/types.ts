export interface CreateIntentInput {
  amount: number;
  orderId: string;
  reservationId: string;
  userId: string;
}

export interface PaymentIntentRef {
  id: string;
  clientSecret: string;
}

export interface PaymentProvider {
  readonly name: 'stripe' | 'mock';
  createIntent(input: CreateIntentInput): Promise<PaymentIntentRef>;
  clientSecretFor(intentId: string): Promise<string>;
  cancel(intentId: string): Promise<void>;
  refund(intentId: string): Promise<void>;
}
