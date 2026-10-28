import { Types } from 'mongoose';
import type { Actor } from '../middleware/auth';
import { Product } from '../models/Product';
import { AppError } from '../utils/AppError';

export function productScope(actor: Actor): Record<string, unknown> {
  return actor.role === 'superadmin' ? {} : { owner: actor.id };
}

export async function scopedProductIds(actor: Actor) {
  const products = await Product.find(productScope(actor))
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  return products.map((product) => product._id);
}

export async function assertManagesProduct(actor: Actor, productId: string) {
  const found = await Product.exists({
    _id: productId,
    ...productScope(actor),
  });
  if (!found) throw new AppError(404, 'Product not found', 'NOT_FOUND');
}
