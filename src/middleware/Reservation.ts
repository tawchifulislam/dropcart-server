import { InferSchemaType, Schema, Types, model } from 'mongoose';

const reservationSchema = new Schema(
  {
    drop: { type: Schema.Types.ObjectId, ref: 'Drop', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    quantity: { type: Number, required: true, min: 1 },
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['active', 'completed', 'expired', 'released'],
      default: 'active',
    },
  },
  { timestamps: true },
);

reservationSchema.index(
  { drop: 1, user: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
reservationSchema.index({ status: 1, expiresAt: 1 });

export type ReservationRecord = InferSchemaType<typeof reservationSchema> & {
  _id: Types.ObjectId;
};
export const Reservation = model('Reservation', reservationSchema);
