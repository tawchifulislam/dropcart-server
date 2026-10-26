import { env } from '../config/env';
import { Drop, DropRecord } from '../models/Drop';
import { Product, ProductRecord } from '../models/Product';
import { Reservation, ReservationRecord } from '../models/Reservation';
import { AppError } from '../utils/AppError';
import { isDuplicateKeyError } from '../utils/mongo';

export const MAX_QUANTITY = 2;

const HOLD_MS = env.RESERVATION_TTL_SECONDS * 1000;
const SWEEP_INTERVAL_MS = 10_000;

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
    { new: true },
  );
}

async function explainFailure(dropId: string, quantity: number) {
  const now = new Date();
  const drop = await Drop.findById(dropId).lean<DropRecord>();
  if (!drop) return new AppError(404, 'Drop not found', 'NOT_FOUND');
  if (now < drop.startsAt)
    return new AppError(409, 'This drop has not started yet', 'NOT_STARTED');
  if (now >= drop.endsAt)
    return new AppError(409, 'This drop has ended', 'ENDED');
  const message =
    drop.stockRemaining === 0 ? 'Sold out' : `Only ${drop.stockRemaining} left`;
  return new AppError(409, quantity > 0 ? message : 'Sold out', 'SOLD_OUT');
}

export async function releaseExpiredReservations() {
  let released = 0;
  for (;;) {
    const reservation = await Reservation.findOneAndUpdate(
      { status: 'active', expiresAt: { $lte: new Date() } },
      { status: 'expired' },
      { new: true },
    );
    if (!reservation) return released;
    await Drop.updateOne(
      { _id: reservation.drop },
      { $inc: { stockRemaining: reservation.quantity } },
    );
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

export async function reserveUnits({ dropId, userId, quantity }: ReserveInput) {
  const existing = await Reservation.findOne({
    drop: dropId,
    user: userId,
    status: 'active',
  });
  if (existing) {
    if (existing.expiresAt > new Date()) {
      throw new AppError(
        409,
        'You already hold a reservation for this drop',
        'ALREADY_RESERVED',
      );
    }
    await releaseExpiredReservations();
  }

  let drop = await takeStock(dropId, quantity);
  if (!drop && (await releaseExpiredReservations()) > 0) {
    drop = await takeStock(dropId, quantity);
  }
  if (!drop) throw await explainFailure(dropId, quantity);

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
    if (isDuplicateKeyError(error)) {
      throw new AppError(
        409,
        'You already hold a reservation for this drop',
        'ALREADY_RESERVED',
      );
    }
    throw error;
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
    { new: true },
  );
  if (!reservation)
    throw new AppError(404, 'Active reservation not found', 'NOT_FOUND');
  const drop = await Drop.findByIdAndUpdate(
    reservation.drop,
    { $inc: { stockRemaining: reservation.quantity } },
    { new: true },
  );
  if (!drop) throw new AppError(404, 'Drop not found', 'NOT_FOUND');
  return drop.toObject<DropRecord>();
}
export async function listUserReservations(userId: string) {
  const now = new Date();
  const reservations = await Reservation.find({ user: userId })
    .sort({ _id: -1 })
    .limit(50)
    .lean<ReservationRecord[]>();
  const drops = await Drop.find({
    _id: { $in: reservations.map((item) => item.drop) },
  }).lean<DropRecord[]>();
  const products = await Product.find({
    _id: { $in: drops.map((drop) => drop.product) },
  }).lean<ProductRecord[]>();

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
