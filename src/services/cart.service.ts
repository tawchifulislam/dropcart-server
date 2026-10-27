import { Cart, CartRecord } from '../models/Cart';
import { Product, ProductRecord } from '../models/Product';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongo';
import { isObjectId } from '../utils/text';
import { attachActiveDrops } from './drop.service';

export async function addToCart(
  userId: string,
  productId: string,
  quantity: number,
) {
  if (!isObjectId(productId))
    throw new AppError(404, 'Product not found', 'NOT_FOUND');
  const product = await Product.findById(productId).lean<ProductRecord>();
  if (!product) throw new AppError(404, 'Product not found', 'NOT_FOUND');

  const updated = await Cart.updateOne(
    { user: userId, 'items.product': productId },
    { $set: { 'items.$.quantity': quantity } },
  );

  if (updated.matchedCount === 0) {
    try {
      await Cart.updateOne(
        { user: userId, 'items.product': { $ne: productId } },
        { $push: { items: { product: productId, quantity } } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      await Cart.updateOne(
        { user: userId, 'items.product': productId },
        { $set: { 'items.$.quantity': quantity } },
      );
    }
  }

  return { id: product._id.toString(), name: product.name, quantity };
}

export async function removeFromCart(userId: string, productId: string) {
  await Cart.updateOne(
    { user: userId },
    { $pull: { items: { product: productId } } },
  );
}

export async function getCart(userId: string) {
  const cart = await Cart.findOne({ user: userId }).lean<CartRecord>();
  const items = cart?.items ?? [];
  const products = await Product.find({
    _id: { $in: items.map((item) => item.product) },
  }).lean<ProductRecord[]>();
  const views = await attachActiveDrops(products);
  const byId = new Map(views.map((view) => [view.id, view]));

  return items.flatMap((item) => {
    const product = byId.get(item.product.toString());
    return product ? [{ quantity: item.quantity, product }] : [];
  });
}
