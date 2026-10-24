import { InferSchemaType, Schema, Types, model } from 'mongoose';

const dropSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    dropPrice: { type: Number, required: true, min: 0 },
    stockTotal: { type: Number, required: true, min: 1 },
    stockRemaining: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

dropSchema.index({ startsAt: 1, endsAt: 1 });

export type DropRecord = InferSchemaType<typeof dropSchema> & {
  _id: Types.ObjectId;
};
export const Drop = model('Drop', dropSchema);
