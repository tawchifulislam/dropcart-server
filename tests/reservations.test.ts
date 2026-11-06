import { Types } from 'mongoose';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { Drop } from '../src/models/Drop';
import { Reservation } from '../src/models/Reservation';
import {
  findActiveReservation,
  releaseExpiredReservations,
  releaseReservation,
  reserveUnits,
} from '../src/services/reservation.service';
import {
  type DropOptions,
  app,
  cookieFor,
  createDrop,
  createProduct,
  newId,
} from './helpers';

async function newDrop(options: DropOptions = {}) {
  const product = await createProduct();
  return createDrop(product.id, options);
}

const stockOf = async (dropId: string) =>
  (await Drop.findById(dropId).lean())?.stockRemaining;

const reserve = (dropId: string, userId = newId(), quantity = 1) =>
  reserveUnits({ dropId, userId, quantity });

const expireNow = (reservationId: Types.ObjectId | string) =>
  Reservation.updateOne(
    { _id: reservationId },
    { expiresAt: new Date(Date.now() - 1000) },
  );

describe('atomic reservation under concurrency', () => {
  it('lets exactly the stock succeed when 200 buyers race for 10 units', async () => {
    const drop = await newDrop({ stock: 10 });

    const results = await Promise.allSettled(
      Array.from({ length: 200 }, () => reserve(drop.id)),
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(10);
    expect(rejected).toHaveLength(190);
    for (const result of rejected) {
      expect(result.reason).toMatchObject({ status: 409, code: 'SOLD_OUT' });
    }
    expect(await stockOf(drop.id)).toBe(0);
    expect(
      await Reservation.countDocuments({ drop: drop.id, status: 'active' }),
    ).toBe(10);
  });

  it('never takes more than the stock when buyers ask for several units', async () => {
    const drop = await newDrop({ stock: 5 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserve(drop.id, newId(), 2)),
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(await stockOf(drop.id)).toBe(1);

    await expect(reserve(drop.id)).resolves.toBeDefined();
    expect(await stockOf(drop.id)).toBe(0);
  });

  it('keeps the same guarantee through the HTTP API', async () => {
    const drop = await newDrop({ stock: 8 });
    const server = app.listen(0);

    try {
      const responses = await Promise.all(
        Array.from({ length: 60 }, () =>
          request(server)
            .post(`/drops/${drop.id}/reserve`)
            .set('Cookie', cookieFor(newId()))
            .send({}),
        ),
      );
      const statuses = responses.map((response) => response.status);

      expect(statuses.filter((status) => status === 201)).toHaveLength(8);
      expect(statuses.filter((status) => status === 409)).toHaveLength(52);
      expect(
        responses.find((response) => response.status === 409)?.body.code,
      ).toBe('SOLD_OUT');
    } finally {
      server.close();
    }
  });
});

describe('reservation rules', () => {
  it('allows one active reservation per user per drop', async () => {
    const drop = await newDrop({ stock: 10 });
    const userId = newId();

    await reserve(drop.id, userId);
    await expect(reserve(drop.id, userId)).rejects.toMatchObject({
      code: 'ALREADY_RESERVED',
    });
    expect(await stockOf(drop.id)).toBe(9);
  });

  it('explains why a drop cannot be reserved', async () => {
    const upcoming = await newDrop({
      startsInMs: 3_600_000,
      endsInMs: 7_200_000,
    });
    const ended = await newDrop({
      startsInMs: -7_200_000,
      endsInMs: -3_600_000,
    });

    await expect(reserve(upcoming.id)).rejects.toMatchObject({
      code: 'NOT_STARTED',
    });
    await expect(reserve(ended.id)).rejects.toMatchObject({ code: 'ENDED' });
    await expect(reserve(newId())).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('reports what is left when a request is larger than the stock', async () => {
    const drop = await newDrop({ stock: 1 });

    await expect(reserve(drop.id, newId(), 2)).rejects.toMatchObject({
      code: 'SOLD_OUT',
      message: 'Only 1 left',
    });
  });

  it('returns the stock when a hold is released, once', async () => {
    const drop = await newDrop({ stock: 3 });
    const userId = newId();
    const { reservation } = await reserve(drop.id, userId);
    expect(await stockOf(drop.id)).toBe(2);

    await releaseReservation(reservation._id.toString(), userId);
    expect(await stockOf(drop.id)).toBe(3);

    await expect(
      releaseReservation(reservation._id.toString(), userId),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await stockOf(drop.id)).toBe(3);
  });

  it('returns an expired hold to the stock exactly once, even with concurrent sweeps', async () => {
    const drop = await newDrop({ stock: 4 });
    const { reservation } = await reserve(drop.id);
    await expireNow(reservation._id);

    const released = await Promise.all([
      releaseExpiredReservations(),
      releaseExpiredReservations(),
      releaseExpiredReservations(),
    ]);

    expect(released.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await stockOf(drop.id)).toBe(4);
    expect((await Reservation.findById(reservation._id))?.status).toBe(
      'expired',
    );
  });

  it('frees a sold-out unit lazily when a hold has expired', async () => {
    const drop = await newDrop({ stock: 1 });
    const first = await reserve(drop.id);
    await expireNow(first.reservation._id);

    const second = await reserve(drop.id);

    expect(second.reservation.status).toBe('active');
    expect(await stockOf(drop.id)).toBe(0);
    expect((await Reservation.findById(first.reservation._id))?.status).toBe(
      'expired',
    );
  });

  it('lets a user reserve again after their hold expired', async () => {
    const drop = await newDrop({ stock: 2 });
    const userId = newId();
    const first = await reserve(drop.id, userId);
    await expireNow(first.reservation._id);

    await expect(reserve(drop.id, userId)).resolves.toBeDefined();
    expect(await stockOf(drop.id)).toBe(1);
  });

  it('ignores expired holds when looking for the active reservation', async () => {
    const drop = await newDrop({ stock: 2 });
    const userId = newId();
    const { reservation } = await reserve(drop.id, userId);
    expect(await findActiveReservation(drop.id, userId)).not.toBeNull();

    await expireNow(reservation._id);
    expect(await findActiveReservation(drop.id, userId)).toBeNull();
  });
  it('short-circuits repeated requests for a drop that just sold out', async () => {
    const drop = await newDrop({ stock: 1 });
    await reserve(drop.id);
    await expect(reserve(drop.id)).rejects.toMatchObject({
      code: 'SOLD_OUT',
    });

    const takeStock = vi.spyOn(Drop, 'findOneAndUpdate');
    await expect(reserve(drop.id)).rejects.toMatchObject({
      code: 'SOLD_OUT',
      message: 'Sold out',
    });

    expect(takeStock).not.toHaveBeenCalled();
    takeStock.mockRestore();
  });

  it('forgets the sold-out memory as soon as stock comes back', async () => {
    const drop = await newDrop({ stock: 1 });
    const holder = newId();
    const first = await reserve(drop.id, holder);
    await expect(reserve(drop.id)).rejects.toMatchObject({
      code: 'SOLD_OUT',
    });

    await releaseReservation(first.reservation._id.toString(), holder);

    await expect(reserve(drop.id)).resolves.toBeDefined();
    expect(await stockOf(drop.id)).toBe(0);
  });
  it('answers requests for a drop that just sold out without touching the stock', async () => {
    const drop = await newDrop({ stock: 1 });
    await reserve(drop.id);
    await expect(reserve(drop.id)).rejects.toMatchObject({
      code: 'SOLD_OUT',
    });

    const takeStock = vi.spyOn(Drop, 'findOneAndUpdate');
    await expect(reserve(drop.id)).rejects.toMatchObject({
      code: 'SOLD_OUT',
      message: 'Sold out',
    });

    expect(takeStock).not.toHaveBeenCalled();
    takeStock.mockRestore();
  });

  it('forgets the sold-out memory as soon as stock comes back', async () => {
    const drop = await newDrop({ stock: 1 });
    const holder = newId();
    const first = await reserve(drop.id, holder);
    await expect(reserve(drop.id)).rejects.toMatchObject({
      code: 'SOLD_OUT',
    });

    await releaseReservation(first.reservation._id.toString(), holder);

    await expect(reserve(drop.id)).resolves.toBeDefined();
    expect(await stockOf(drop.id)).toBe(0);
  });
});
