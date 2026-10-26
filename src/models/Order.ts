import { InferSchemaType, Schema, Types, model } from 'mongoose';

const orderSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    drop: { type: Schema.Types.ObjectId, ref: 'Drop', required: true },
    reservation: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      required: true,
      unique: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    provider: { type: String, enum: ['stripe', 'mock'], required: true },
    paymentIntentId: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: ['pending', 'paid', 'cancelled', 'refunded', 'refund_failed'],
      default: 'pending',
    },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

export type OrderRecord = InferSchemaType<typeof orderSchema> & {
  _id: Types.ObjectId;
};
export const Order = model('Order', orderSchema);
