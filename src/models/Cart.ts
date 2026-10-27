import { InferSchemaType, Schema, Types, model } from 'mongoose';

const itemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    items: { type: [itemSchema], default: [] },
  },
  { timestamps: true },
);

export type CartRecord = InferSchemaType<typeof cartSchema> & {
  _id: Types.ObjectId;
};
export const Cart = model('Cart', cartSchema);
