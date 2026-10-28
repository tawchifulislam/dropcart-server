import { InferSchemaType, Schema, Types, model } from 'mongoose';

const variantSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, index: true },
    images: { type: [String], default: [] },
    variants: { type: [variantSchema], default: [] },
    specs: { type: Schema.Types.Mixed, default: {} },
    basePrice: { type: Number, required: true, min: 0 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true },
);

export type ProductRecord = InferSchemaType<typeof productSchema> & {
  _id: Types.ObjectId;
};
export const Product = model('Product', productSchema);
