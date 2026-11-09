import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { Order, type OrderRecord } from '../src/models/Order';
import { Reservation } from '../src/models/Reservation';
import {
  confirmMockPayment,
  fulfillOrder,
  startCheckout,
} from '../src/services/payment.service';
import {
  releaseExpiredReservations,
  releaseReservation,
  reserveUnits,
} from '../src/services/reservation.service';
import { createLiveDrop, newId, stockOf } from './helpers';

async function pendingOrder(dropId: string, userId = newId()) {
  const { reservation } = await reserveUnits({ dropId, userId, quantity: 1 });
  const checkout = await startCheckout(reservation._id.toString(), userId);
  const order = await Order.findById(checkout.orderId).lean<OrderRecord>();
  if (!order) throw new Error('The order was not created');
  return { order, userId, reservationId: reservation._id.toString(), checkout };
}

async function expire(reservationId: Types.ObjectId | string) {
  await Reservation.updateOne(
    { _id: reservationId },
    { expiresAt: new Date(Date.now() - 1000) },
  );
  await releaseExpiredReservations();
}

describe('payment fulfillment', () => {
  it('fulfills a normal payment', async () => {
    const drop = await createLiveDrop({ stock: 1 });
    const { order, reservationId } = await pendingOrder(drop.id);

    await expect(fulfillOrder(order)).resolves.toBe('paid');

    expect((await Order.findById(order._id))?.status).toBe('paid');
    expect((await Reservation.findById(reservationId))?.status).toBe(
      'completed',
    );
    expect(await stockOf(drop.id)).toBe(0);
  });

  it('fulfills exactly once when five webhooks arrive at the same time', async () => {
    const drop = await createLiveDrop({ stock: 1 });
    const { order, reservationId } = await pendingOrder(drop.id);

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => fulfillOrder(order)),
    );

    expect(outcomes.filter((outcome) => outcome === 'paid')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(
      4,
    );
    expect((await Order.findById(order._id))?.status).toBe('paid');
    expect((await Reservation.findById(reservationId))?.status).toBe(
      'completed',
    );
    expect(await stockOf(drop.id)).toBe(0);
  });

  it('honors a late payment when the unit is still available', async () => {
    const drop = await createLiveDrop({ stock: 1 });
    const { order, reservationId } = await pendingOrder(drop.id);
    await expire(reservationId);
    expect(await stockOf(drop.id)).toBe(1);

    await expect(fulfillOrder(order)).resolves.toBe('paid-late');

    expect(await stockOf(drop.id)).toBe(0);
    expect((await Order.findById(order._id))?.status).toBe('paid');
    expect((await Reservation.findById(reservationId))?.status).toBe(
      'completed',
    );
  });

  it('refunds a late payment when the unit was taken by someone else', async () => {
    const drop = await createLiveDrop({ stock: 1 });
    const { order, reservationId } = await pendingOrder(drop.id);
    await expire(reservationId);
    await reserveUnits({ dropId: drop.id, userId: newId(), quantity: 1 });

    await expect(fulfillOrder(order)).resolves.toBe('refunded');

    expect((await Order.findById(order._id))?.status).toBe('refunded');
    expect(await stockOf(drop.id)).toBe(0);
  });

  it('does not return the stock of a reservation whose order is already paid', async () => {
    const drop = await createLiveDrop({ stock: 1 });
    const userId = newId();
    const { reservation } = await reserveUnits({
      dropId: drop.id,
      userId,
      quantity: 1,
    });
    await Order.create({
      user: userId,
      drop: drop.id,
      reservation: reservation._id,
      quantity: 1,
      amount: 500,
      currency: 'bdt',
      provider: 'mock',
      status: 'paid',
    });

    await expire(reservation._id);

    expect(await stockOf(drop.id)).toBe(0);
    expect((await Reservation.findById(reservation._id))?.status).toBe(
      'completed',
    );
  });
});

describe('checkout', () => {
  it('reuses one order and one session when checkout is requested twice', async () => {
    const drop = await createLiveDrop({ stock: 3 });
    const userId = newId();
    const { reservation } = await reserveUnits({
      dropId: drop.id,
      userId,
      quantity: 1,
    });

    const first = await startCheckout(reservation._id.toString(), userId);
    const second = await startCheckout(reservation._id.toString(), userId);

    expect(second.orderId).toBe(first.orderId);
    expect(second.url).toBe(first.url);
    expect(await Order.countDocuments()).toBe(1);
  });

  it('refuses to start checkout for an expired reservation', async () => {
    const drop = await createLiveDrop({ stock: 3 });
    const userId = newId();
    const { reservation } = await reserveUnits({
      dropId: drop.id,
      userId,
      quantity: 1,
    });
    await expire(reservation._id);

    await expect(
      startCheckout(reservation._id.toString(), userId),
    ).rejects.toMatchObject({
      code: 'RESERVATION_EXPIRED',
    });
  });

  it('cancels the pending order when the hold is released', async () => {
    const drop = await createLiveDrop({ stock: 3 });
    const { order, userId, reservationId } = await pendingOrder(drop.id);

    await releaseReservation(reservationId, userId);

    await vi.waitFor(async () => {
      expect((await Order.findById(order._id))?.status).toBe('cancelled');
    });
  });

  it('confirms a mock payment for its owner only', async () => {
    const drop = await createLiveDrop({ stock: 3 });
    const { order, userId } = await pendingOrder(drop.id);
    const orderId = order._id.toString();

    await expect(confirmMockPayment(orderId, newId())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(confirmMockPayment(orderId, userId)).resolves.toBeUndefined();
    expect((await Order.findById(order._id))?.status).toBe('paid');
  });
});
