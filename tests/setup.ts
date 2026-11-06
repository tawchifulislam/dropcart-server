import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import '../src/models/Cart';
import '../src/models/ChatSession';
import '../src/models/Drop';
import '../src/models/Order';
import '../src/models/Product';
import '../src/models/Reservation';
import '../src/models/User';
import { resetReservationState } from '../src/services/reservation.service';

beforeAll(async () => {
  await mongoose.connect(inject('MONGO_URI' as never) as string, {
    dbName: `test_${randomUUID().slice(0, 8)}`,
  });
  await Promise.all(
    mongoose.modelNames().map((name) => mongoose.model(name).init()),
  );
});

beforeEach(async () => {
  resetReservationState();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
