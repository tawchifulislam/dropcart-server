import { Request, Response } from 'express';
import { z } from 'zod';
import { currentUserId } from '../middleware/auth';
import { toDropView } from '../services/drop.service';
import {
  MAX_QUANTITY,
  findActiveReservation,
  releaseReservation,
  reserveUnits,
  toReservationView,
} from '../services/reservation.service';
import { AppError } from '../utils/AppError';
import { isObjectId } from '../utils/text';

const reserveBody = z.object({
  quantity: z.number().int().min(1).max(MAX_QUANTITY).default(1),
});

function parseId(id: string, label: string) {
  if (!isObjectId(id))
    throw new AppError(404, `${label} not found`, 'NOT_FOUND');
  return id;
}

export async function reserve(req: Request<{ id: string }>, res: Response) {
  const dropId = parseId(req.params.id, 'Drop');
  const { quantity } = reserveBody.parse(req.body ?? {});
  const { reservation, drop } = await reserveUnits({
    dropId,
    userId: currentUserId(req),
    quantity,
  });
  res.status(201).json({
    reservation: toReservationView(reservation),
    drop: toDropView(drop),
  });
}

export async function getMyReservation(
  req: Request<{ id: string }>,
  res: Response,
) {
  const dropId = parseId(req.params.id, 'Drop');
  const reservation = await findActiveReservation(dropId, currentUserId(req));
  res.json({
    reservation: reservation ? toReservationView(reservation) : null,
  });
}

export async function release(req: Request<{ id: string }>, res: Response) {
  const reservationId = parseId(req.params.id, 'Reservation');
  const drop = await releaseReservation(reservationId, currentUserId(req));
  res.json({ drop: toDropView(drop) });
}
