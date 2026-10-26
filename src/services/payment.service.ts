import type { Types } from 'mongoose';
import type Stripe from 'stripe';
import { env } from '../config/env';
import { Drop, DropRecord } from '../models/Drop';
import { Order, OrderRecord } from '../models/Order';
import { Product, ProductRecord } from '../models/Product';
import { Reservation, ReservationRecord } from '../models/Reservation';
import { User } from '../models/User';
import { paymentProvider } from '../payments';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongo';

export type Fulfillment = 'paid' | 'paid-late' | 'refunded' | 'duplicate';

const SESSION_MARGIN_SECONDS = 31 * 60;
const LOCAL_ORIGIN = /localhost|127\.0\.0\.1/;

function publicImageUrl(path?: string) {
  if (!path || LOCAL_ORIGIN.test(env.CLIENT_ORIGIN)) return undefined;
  return new URL(path, env.CLIENT_ORIGIN).toString();
}

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
  const [product, user] = await Promise.all([
    Product.findById(drop.product).lean<ProductRecord>(),
    User.findById(userId).lean<{ email: string }>(),
  ]);
  if (!product) throw new AppError(404, 'Product not found', 'NOT_FOUND');
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

  if (order.sessionId) {
    const url = await paymentProvider.urlFor(order.sessionId);
    if (!url)
      throw new AppError(409, 'This payment session has ended', 'ORDER_CLOSED');
    return { ...base, url };
  }

  const session = await paymentProvider.createSession({
    orderId: order.id,
    reservationId: reservation._id.toString(),
    dropId: drop._id.toString(),
    userId,
    customerEmail: user?.email,
    productName: product.name,
    productImageUrl: publicImageUrl(product.images[0]),
    quantity: reservation.quantity,
    unitAmount: drop.dropPrice,
    successUrl: `${env.CLIENT_ORIGIN}/checkout/complete?order=${order.id}`,
    cancelUrl: `${env.CLIENT_ORIGIN}/checkout/${reservation._id.toString()}`,
    expiresAt:
      Math.floor(order._id.getTimestamp().getTime() / 1000) +
      env.RESERVATION_TTL_SECONDS +
      SESSION_MARGIN_SECONDS,
  });
  order.sessionId = session.id;
  await order.save();
  return { ...base, url: session.url };
}

export async function cancelPendingPayment(
  reservationId: Types.ObjectId | string,
) {
  try {
    const order = await Order.findOneAndUpdate(
      { reservation: reservationId, status: 'pending' },
      { status: 'cancelled' },
    );
    if (order?.sessionId) await paymentProvider.cancel(order.sessionId);
  } catch (error) {
    console.error('Could not cancel the pending payment', error);
  }
}

export async function fulfillOrder(
  order: OrderRecord,
  paymentIntentId?: string,
): Promise<Fulfillment> {
  const now = new Date();
  const intentId = paymentIntentId ?? order.paymentIntentId;
  const paid = {
    status: 'paid' as const,
    paidAt: now,
    ...(intentId ? { paymentIntentId: intentId } : {}),
  };

  const held = await Reservation.findOneAndUpdate(
    { _id: order.reservation, status: 'active' },
    { status: 'completed' },
  );
  if (held) {
    await Order.updateOne({ _id: order._id }, paid);
    return 'paid';
  }

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: { $in: ['pending', 'cancelled'] } },
    paid,
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
    if (intentId) await paymentProvider.refund(intentId);
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
  if (
    event.type !== 'checkout.session.completed' &&
    event.type !== 'checkout.session.async_payment_succeeded'
  ) {
    return;
  }

  const session = event.data.object;
  if (session.payment_status !== 'paid') return;

  const order = await Order.findOne({
    sessionId: session.id,
  }).lean<OrderRecord>();
  if (!order) return;

  const intentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  await fulfillOrder(order, intentId);
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
