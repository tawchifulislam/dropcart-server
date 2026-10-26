import { Request, Response } from 'express';
import { currentUserId } from '../middleware/auth';
import {
  confirmMockPayment,
  getOrderView,
  startCheckout,
} from '../services/payment.service';
import { AppError } from '../utils/AppError';
import { isObjectId } from '../utils/text';

function parseId(id: string, label: string) {
  if (!isObjectId(id))
    throw new AppError(404, `${label} not found`, 'NOT_FOUND');
  return id;
}

export async function createCheckout(
  req: Request<{ reservationId: string }>,
  res: Response,
) {
  const reservationId = parseId(req.params.reservationId, 'Reservation');
  res.json(await startCheckout(reservationId, currentUserId(req)));
}

export async function getOrder(req: Request<{ id: string }>, res: Response) {
  const orderId = parseId(req.params.id, 'Order');
  res.json(await getOrderView(orderId, currentUserId(req)));
}

export async function mockConfirm(req: Request<{ id: string }>, res: Response) {
  const orderId = parseId(req.params.id, 'Order');
  const userId = currentUserId(req);
  await confirmMockPayment(orderId, userId);
  res.json(await getOrderView(orderId, userId));
}
