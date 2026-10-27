import { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../middleware/auth';
import { addToCart, getCart, removeFromCart } from '../services/cart.service';
import { MAX_QUANTITY } from '../services/reservation.service';
import { AppError } from '../utils/AppError';
import { isObjectId } from '../utils/text';

const addBody = z.object({
  productId: z.string().trim(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
});

export async function listCart(req: Request, res: Response) {
  res.json({ items: await getCart(currentUserId(req)) });
}

export async function addCartItem(req: Request, res: Response) {
  const input = addBody.parse(req.body);
  res
    .status(201)
    .json(await addToCart(currentUserId(req), input.productId, input.quantity));
}

export async function removeCartItem(
  req: Request<{ productId: string }>,
  res: Response,
) {
  if (!isObjectId(req.params.productId))
    throw new AppError(404, 'Product not found', 'NOT_FOUND');
  await removeFromCart(currentUserId(req), req.params.productId);
  res.status(204).end();
}
