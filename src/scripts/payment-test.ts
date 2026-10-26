import mongoose, { Types } from 'mongoose';
import { connectDb } from '../config/db';
import { Drop } from '../models/Drop';
import { Order, OrderRecord } from '../models/Order';
import { Product } from '../models/Product';
import { Reservation } from '../models/Reservation';
import { paymentProvider } from '../payments';
import { fulfillOrder, startCheckout } from '../services/payment.service';
import {
  releaseExpiredReservations,
  reserveUnits,
} from '../services/reservation.service';

const newUser = () => new Types.ObjectId().toString();
let failures = 0;

function check(name: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures += 1;
}

async function stockOf(dropId: string) {
  return (await Drop.findById(dropId).lean())?.stockRemaining;
}

async function pendingOrder(dropId: string, userId: string) {
  const { reservation } = await reserveUnits({ dropId, userId, quantity: 1 });
  const checkout = await startCheckout(reservation._id.toString(), userId);
  const order = await Order.findById(checkout.orderId).lean<OrderRecord>();
  if (!order) throw new Error('Order was not created');
  return { order, reservationId: reservation._id.toString() };
}

async function expire(reservationId: string) {
  await Reservation.updateOne(
    { _id: reservationId },
    { expiresAt: new Date(Date.now() - 1000) },
  );
  await releaseExpiredReservations();
}

async function run() {
  if (paymentProvider.name !== 'mock') {
    throw new Error('Run this test with PAYMENT_PROVIDER=mock');
  }
  await connectDb();

  const stamp = Date.now();
  const product = await Product.create({
    name: `Payment test ${stamp}`,
    slug: `payment-test-${stamp}`,
    description: 'Temporary product for the payment test.',
    category: 'Test',
    basePrice: 100,
  });
  const dropIds: string[] = [];
  const makeDrop = async () => {
    const drop = await Drop.create({
      product: product._id,
      startsAt: new Date(stamp - 60_000),
      endsAt: new Date(stamp + 3_600_000),
      dropPrice: 100,
      stockTotal: 1,
      stockRemaining: 1,
    });
    dropIds.push(drop.id);
    return drop.id as string;
  };

  try {
    const normalDrop = await makeDrop();
    const normal = await pendingOrder(normalDrop, newUser());
    check(
      'normal payment is fulfilled',
      (await fulfillOrder(normal.order)) === 'paid',
    );
    check(
      'normal payment leaves stock at 0',
      (await stockOf(normalDrop)) === 0,
    );

    const repeatDrop = await makeDrop();
    const repeat = await pendingOrder(repeatDrop, newUser());
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => fulfillOrder(repeat.order)),
    );
    check(
      '5 concurrent webhooks fulfill exactly once',
      outcomes.filter((o) => o === 'paid').length === 1,
    );
    check(
      'the other 4 are ignored as duplicates',
      outcomes.filter((o) => o === 'duplicate').length === 4,
    );
    check('duplicates do not change stock', (await stockOf(repeatDrop)) === 0);

    const lateDrop = await makeDrop();
    const late = await pendingOrder(lateDrop, newUser());
    await expire(late.reservationId);
    check('expiry returns the unit to stock', (await stockOf(lateDrop)) === 1);
    check(
      'late payment re-takes available stock',
      (await fulfillOrder(late.order)) === 'paid-late',
    );
    check('late payment leaves stock at 0', (await stockOf(lateDrop)) === 0);

    const lostDrop = await makeDrop();
    const lost = await pendingOrder(lostDrop, newUser());
    await expire(lost.reservationId);
    await reserveUnits({ dropId: lostDrop, userId: newUser(), quantity: 1 });
    check(
      'late payment after the unit was taken is refunded',
      (await fulfillOrder(lost.order)) === 'refunded',
    );
    check(
      'refunded order is saved as refunded',
      (await Order.findById(lost.order._id))?.status === 'refunded',
    );
  } finally {
    await Order.deleteMany({ drop: { $in: dropIds } });
    await Reservation.deleteMany({ drop: { $in: dropIds } });
    await Drop.deleteMany({ _id: { $in: dropIds } });
    await Product.deleteOne({ _id: product._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
