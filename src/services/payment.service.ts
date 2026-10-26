import type { Types } from 'mongoose';
import type Stripe from 'stripe';
import { env } from '../config/env';
import { Drop, DropRecord } from '../models/Drop';
import { Order, OrderRecord } from '../models/Order';
import { Product, ProductRecord } from '../models/Product';
import { Reservation, ReservationRecord } from '../models/Reservation';
import { paymentProvider } from '../payments';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongo';

export type Fulfillment = 'paid' | 'paid-late' | 'refunded' | 'duplicate';

export async function startCheckout(reservationId: string, userId: string) {
  const reservation = await Reservation.findOne({
    _id: reservationId,
    user: userId,
  }).lean<ReservationRecord>();
  if (!reservation)
    throw new AppError(404, 'Reservation not found', 'NOT_FOUND');
  if (reservation.status !== 'active' || reservation.expiresAt <= new Date()) {
    throw new AppError(
      409,
      'This reservation is no longer active',
      'RESERVATION_EXPIRED',
    );
  }

  const drop = await Drop.findById(reservation.drop).lean<DropRecord>();
  if (!drop) throw new AppError(404, 'Drop not found', 'NOT_FOUND');
  const amount = drop.dropPrice * reservation.quantity;

  let order = await Order.findOne({ reservation: reservation._id });
  if (!order) {
    try {
      order = await Order.create({
        user: userId,
        drop: drop._id,
        reservation: reservation._id,
        quantity: reservation.quantity,
        amount,
        currency: env.PAYMENT_CURRENCY,
        provider: paymentProvider.name,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      order = await Order.findOne({ reservation: reservation._id });
    }
  }
  if (!order)
    throw new AppError(500, 'Could not create the order', 'ORDER_FAILED');
  if (order.status !== 'pending') {
    throw new AppError(409, 'This order is already closed', 'ORDER_CLOSED');
  }

  const base = { provider: paymentProvider.name, orderId: order.id, amount };

  if (order.paymentIntentId) {
    return {
      ...base,
      clientSecret: await paymentProvider.clientSecretFor(
        order.paymentIntentId,
      ),
    };
  }

  const intent = await paymentProvider.createIntent({
    amount,
    orderId: order.id,
    reservationId: reservation._id.toString(),
    userId,
  });
  order.paymentIntentId = intent.id;
  await order.save();
  return { ...base, clientSecret: intent.clientSecret };
}

export async function cancelPendingPayment(
  reservationId: Types.ObjectId | string,
) {
  try {
    const order = await Order.findOneAndUpdate(
      { reservation: reservationId, status: 'pending' },
      { status: 'cancelled' },
    );
    if (order?.paymentIntentId)
      await paymentProvider.cancel(order.paymentIntentId);
  } catch (error) {
    console.error('Could not cancel the pending payment', error);
  }
}

export async function fulfillOrder(order: OrderRecord): Promise<Fulfillment> {
  const now = new Date();

  const held = await Reservation.findOneAndUpdate(
    { _id: order.reservation, status: 'active' },
    { status: 'completed' },
  );
  if (held) {
    await Order.updateOne({ _id: order._id }, { status: 'paid', paidAt: now });
    return 'paid';
  }

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ['pending', 'cancelled'] } },
    { status: 'paid', paidAt: now },
  );
  if (!claimed) return 'duplicate';

  const reclaimed = await Drop.findOneAndUpdate(
    { _id: order.drop, stockRemaining: { $gte: order.quantity } },
    { $inc: { stockRemaining: -order.quantity } },
  );
  if (reclaimed) {
    await Reservation.updateOne(
      { _id: order.reservation },
      { status: 'completed' },
    );
    return 'paid-late';
  }

  try {
    if (order.paymentIntentId)
      await paymentProvider.refund(order.paymentIntentId);
    await Order.updateOne(
      { _id: order._id },
      { status: 'refunded', $unset: { paidAt: '' } },
    );
    return 'refunded';
  } catch (error) {
    await Order.updateOne({ _id: order._id }, { status: 'refund_failed' });
    throw error;
  }
}

export async function handleStripeEvent(event: Stripe.Event) {
  if (event.type !== 'payment_intent.succeeded') return;
  const order = await Order.findOne({
    paymentIntentId: event.data.object.id,
  }).lean<OrderRecord>();
  if (order) await fulfillOrder(order);
}

export async function confirmMockPayment(orderId: string, userId: string) {
  if (paymentProvider.name !== 'mock')
    throw new AppError(404, 'Not found', 'NOT_FOUND');
  const order = await Order.findOne({
    _id: orderId,
    user: userId,
  }).lean<OrderRecord>();
  if (!order) throw new AppError(404, 'Order not found', 'NOT_FOUND');
  if (order.status === 'paid') return;
  if (order.status !== 'pending') {
    throw new AppError(409, 'This order can no longer be paid', 'ORDER_CLOSED');
  }
  await fulfillOrder(order);
}

export async function getOrderView(orderId: string, userId: string) {
  const order = await Order.findOne({
    _id: orderId,
    user: userId,
  }).lean<OrderRecord>();
  if (!order) throw new AppError(404, 'Order not found', 'NOT_FOUND');
  const drop = await Drop.findById(order.drop).lean<DropRecord>();
  const product = drop
    ? await Product.findById(drop.product).lean<ProductRecord>()
    : null;

  return {
    id: order._id.toString(),
    status: order.status,
    amount: order.amount,
    quantity: order.quantity,
    dropId: order.drop.toString(),
    reservationId: order.reservation.toString(),
    paidAt: order.paidAt ?? null,
    product: product
      ? { name: product.name, slug: product.slug, image: product.images[0] }
      : null,
  };
}
