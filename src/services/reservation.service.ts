import { env } from '../config/env';
import { Drop, DropRecord } from '../models/Drop';
import { Order, OrderRecord } from '../models/Order';
import { Product, ProductRecord } from '../models/Product';
import { Reservation, ReservationRecord } from '../models/Reservation';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongo';
import { cancelPendingPayment } from './payment.service';

export const MAX_QUANTITY = 2;

const HOLD_MS = env.RESERVATION_TTL_SECONDS * 1000;
const SWEEP_INTERVAL_MS = 10_000;
const SOLD_OUT_TTL_MS = 1_000;
const SWEEP_THROTTLE_MS = 2_000;
const soldOutUntil = new Map<string, number>();
let lastSweepAt = 0;

function rememberSoldOut(dropId: string) {
  const now = Date.now();
  if (soldOutUntil.size > 500) {
    for (const [id, until] of soldOutUntil) {
      if (until <= now) soldOutUntil.delete(id);
    }
  }
  soldOutUntil.set(dropId, now + SOLD_OUT_TTL_MS);
}

const isRememberedSoldOut = (dropId: string) =>
  (soldOutUntil.get(dropId) ?? 0) > Date.now();

function forgetSoldOut(dropId: string) {
  soldOutUntil.delete(dropId);
}

async function sweepIfDue() {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_THROTTLE_MS) return 0;
  lastSweepAt = now;
  return releaseExpiredReservations();
}

export function resetReservationState() {
  soldOutUntil.clear();
  lastSweepAt = 0;
}

interface ReserveInput {
  dropId: string;
  userId: string;
  quantity: number;
}

export function toReservationView(
  reservation: ReservationRecord,
  now = new Date(),
) {
  return {
    id: reservation._id.toString(),
    dropId: reservation.drop.toString(),
    quantity: reservation.quantity,
    status: reservation.status,
    expiresAt: reservation.expiresAt,
    expiresInMs: Math.max(0, reservation.expiresAt.getTime() - now.getTime()),
    holdMs: HOLD_MS,
  };
}

function takeStock(dropId: string, quantity: number) {
  const now = new Date();
  return Drop.findOneAndUpdate(
    {
      _id: dropId,
      startsAt: { $lte: now },
      endsAt: { $gt: now },
      stockRemaining: { $gte: quantity },
    },
    { $inc: { stockRemaining: -quantity } },
    { returnDocument: 'after' },
  );
}

async function explainFailure(dropId: string) {
  const now = new Date();
  const drop = await Drop.findById(dropId).lean<DropRecord>();
  if (!drop) return new AppError(404, 'Drop not found', 'NOT_FOUND');
  if (now < drop.startsAt)
    return new AppError(409, 'This drop has not started yet', 'NOT_STARTED');
  if (now >= drop.endsAt)
    return new AppError(409, 'This drop has ended', 'ENDED');
  if (drop.stockRemaining === 0) {
    rememberSoldOut(dropId);
    return new AppError(409, 'Sold out', 'SOLD_OUT');
  }
  return new AppError(409, `Only ${drop.stockRemaining} left`, 'SOLD_OUT');
}

export async function releaseExpiredReservations() {
  let released = 0;
  for (;;) {
    const reservation = await Reservation.findOneAndUpdate(
      { status: 'active', expiresAt: { $lte: new Date() } },
      { status: 'expired' },
      { returnDocument: 'after' },
    );
    if (!reservation) return released;

    if (await Order.exists({ reservation: reservation._id, status: 'paid' })) {
      await Reservation.updateOne(
        { _id: reservation._id },
        { status: 'completed' },
      );
      continue;
    }

    await Drop.updateOne(
      { _id: reservation.drop },
      { $inc: { stockRemaining: reservation.quantity } },
    );
    forgetSoldOut(reservation.drop.toString());
    void cancelPendingPayment(reservation._id);
    released += 1;
  }
}

export function startReservationSweeper() {
  const timer = setInterval(() => {
    releaseExpiredReservations().catch((error) =>
      console.error('Reservation sweep failed', error),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

export function reserveUnits(input: ReserveInput) {
  return attemptReservation(input, true);
}

async function attemptReservation(
  { dropId, userId, quantity }: ReserveInput,
  canRetry: boolean,
): Promise<{ reservation: ReservationRecord; drop: DropRecord }> {
  if (isRememberedSoldOut(dropId))
    throw new AppError(409, 'Sold out', 'SOLD_OUT');

  let drop = await takeStock(dropId, quantity);
  if (!drop && (await sweepIfDue()) > 0)
    drop = await takeStock(dropId, quantity);
  if (!drop) throw await explainFailure(dropId);

  try {
    const reservation = await Reservation.create({
      drop: dropId,
      user: userId,
      quantity,
      expiresAt: new Date(Date.now() + HOLD_MS),
    });
    return {
      reservation: reservation.toObject<ReservationRecord>(),
      drop: drop.toObject<DropRecord>(),
    };
  } catch (error) {
    await Drop.updateOne(
      { _id: dropId },
      { $inc: { stockRemaining: quantity } },
    );
    forgetSoldOut(dropId);
    if (!isDuplicateKeyError(error)) throw error;
    if (canRetry && (await releaseExpiredReservations()) > 0) {
      return attemptReservation({ dropId, userId, quantity }, false);
    }
    throw new AppError(
      409,
      'You already hold a reservation for this drop',
      'ALREADY_RESERVED',
    );
  }
}

export function findActiveReservation(dropId: string, userId: string) {
  return Reservation.findOne({
    drop: dropId,
    user: userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  }).lean<ReservationRecord>();
}

export async function releaseReservation(
  reservationId: string,
  userId: string,
) {
  const reservation = await Reservation.findOneAndUpdate(
    { _id: reservationId, user: userId, status: 'active' },
    { status: 'released' },
    { returnDocument: 'after' },
  );
  if (!reservation) {
    throw new AppError(404, 'Active reservation not found', 'NOT_FOUND');
  }
  void cancelPendingPayment(reservation._id);
  const drop = await Drop.findByIdAndUpdate(
    reservation.drop,
    { $inc: { stockRemaining: reservation.quantity } },
    { returnDocument: 'after' },
  );
  forgetSoldOut(reservation.drop.toString());
  if (!drop) throw new AppError(404, 'Drop not found', 'NOT_FOUND');
  return drop.toObject<DropRecord>();
}
async function loadHistory(reservations: ReservationRecord[]) {
  const now = new Date();
  const drops = await Drop.find({
    _id: { $in: reservations.map((item) => item.drop) },
  }).lean<DropRecord[]>();
  const products = await Product.find({
    _id: { $in: drops.map((drop) => drop.product) },
  }).lean<ProductRecord[]>();

  const orders = await Order.find({
    reservation: { $in: reservations.map((item) => item._id) },
  }).lean<OrderRecord[]>();
  const orderByReservation = new Map(
    orders.map((order) => [order.reservation.toString(), order]),
  );

  const dropById = new Map(drops.map((drop) => [drop._id.toString(), drop]));
  const productById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );

  return reservations.flatMap((reservation) => {
    const drop = dropById.get(reservation.drop.toString());
    const product = drop ? productById.get(drop.product.toString()) : undefined;
    if (!drop || !product) return [];
    const expired =
      reservation.status === 'active' && reservation.expiresAt <= now;
    return [
      {
        id: reservation._id.toString(),
        dropId: drop._id.toString(),
        quantity: reservation.quantity,
        status: expired ? 'expired' : reservation.status,
        expiresAt: reservation.expiresAt,
        expiresInMs: expired
          ? 0
          : Math.max(0, reservation.expiresAt.getTime() - now.getTime()),
        holdMs: HOLD_MS,
        orderId:
          orderByReservation.get(reservation._id.toString())?._id.toString() ??
          null,
        createdAt: reservation._id.getTimestamp(),
        dropPrice: drop.dropPrice,
        product: {
          id: product._id.toString(),
          name: product.name,
          slug: product.slug,
          image: product.images[0],
        },
      },
    ];
  });
}

export async function listUserReservations(userId: string) {
  const reservations = await Reservation.find({ user: userId })
    .sort({ _id: -1 })
    .limit(50)
    .lean<ReservationRecord[]>();
  return loadHistory(reservations);
}

export async function getUserReservation(
  reservationId: string,
  userId: string,
) {
  const reservation = await Reservation.findOne({
    _id: reservationId,
    user: userId,
  }).lean<ReservationRecord>();
  if (!reservation) return null;
  const [item] = await loadHistory([reservation]);
  return item ?? null;
}
