import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import { connectDb } from '../config/db';
import { env } from '../config/env';
import { AUTH_COOKIE } from '../middleware/auth';
import { Drop } from '../models/Drop';
import { Product } from '../models/Product';
import { Reservation } from '../models/Reservation';

const BASE_URL = process.env.LOAD_TEST_URL ?? `http://localhost:${env.PORT}`;
const STOCK = Number(process.env.LOAD_TEST_STOCK ?? 10);
const BUYERS = Number(process.env.LOAD_TEST_BUYERS ?? 200);
const LATE = Number(process.env.LOAD_TEST_LATE ?? BUYERS);

interface Shot {
  status: number;
  ms: number;
  error?: string;
}

async function fire(dropId: string): Promise<Shot> {
  const token = jwt.sign(
    { sub: new Types.ObjectId().toString(), role: 'shopper' },
    env.JWT_SECRET,
    {
      expiresIn: 600,
    },
  );
  const started = performance.now();
  try {
    const response = await fetch(`${BASE_URL}/drops/${dropId}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE}=${token}`,
      },
      body: '{}',
    });
    await response.text();
    return { status: response.status, ms: performance.now() - started };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return {
      status: 0,
      ms: performance.now() - started,
      error: cause?.code ?? String(error),
    };
  }
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

const describeTimes = (times: number[]) =>
  `${Math.round(percentile(times, 50))} / ${Math.round(percentile(times, 95))} / ${Math.round(
    times[times.length - 1],
  )} ms`;

function tally(shots: Shot[]) {
  const counts = new Map<number, number>();
  for (const shot of shots)
    counts.set(shot.status, (counts.get(shot.status) ?? 0) + 1);
  return [...counts]
    .map(
      ([status, count]) => `${status === 0 ? 'no response' : status}: ${count}`,
    )
    .join(', ');
}

async function ensureServerIsReachable() {
  const response = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (!response?.ok) {
    throw new Error(
      `The API is not reachable at ${BASE_URL}. Start it with the same MONGODB_DB as this script.`,
    );
  }
}

async function run() {
  await ensureServerIsReachable();
  await connectDb();
  const stamp = Date.now();
  const product = await Product.create({
    name: `Load test ${stamp}`,
    slug: `load-test-${stamp}`,
    description: 'Temporary product for the reservation load test.',
    category: 'Test',
    basePrice: 100,
  });
  const drop = await Drop.create({
    product: product._id,
    startsAt: new Date(stamp - 60_000),
    endsAt: new Date(stamp + 3_600_000),
    dropPrice: 100,
    stockTotal: STOCK,
    stockRemaining: STOCK,
  });

  try {
    const burstStarted = performance.now();
    const burst = await Promise.all(
      Array.from({ length: BUYERS }, () => fire(drop.id)),
    );
    const burstWall = performance.now() - burstStarted;

    const reserved = burst.filter((shot) => shot.status === 201).length;
    const soldOut = burst.filter((shot) => shot.status === 409).length;
    const other = BUYERS - reserved - soldOut;
    const burstTimes = burst.map((shot) => shot.ms).sort((a, b) => a - b);
    const finalDrop = await Drop.findById(drop._id).lean();
    const holds = await Reservation.countDocuments({
      drop: drop._id,
      status: 'active',
    });

    const lateStarted = performance.now();
    const late = await Promise.all(
      Array.from({ length: LATE }, () => fire(drop.id)),
    );
    const lateWall = performance.now() - lateStarted;
    const lateSoldOut = late.filter((shot) => shot.status === 409).length;
    const lateTimes = late.map((shot) => shot.ms).sort((a, b) => a - b);
    const firstError = [...burst, ...late].find((shot) => shot.error)?.error;

    const passed =
      reserved === STOCK &&
      soldOut === BUYERS - STOCK &&
      other === 0 &&
      finalDrop?.stockRemaining === 0 &&
      holds === STOCK &&
      lateSoldOut === LATE;

    console.log('Reservation load test');
    console.log(
      `  stock ${STOCK}, simultaneous buyers ${BUYERS}, latecomers ${LATE}`,
    );
    console.log(`  burst statuses:             ${tally(burst)}`);
    console.log(`  latecomers statuses:        ${tally(late)}`);
    if (firstError) console.log(`  first transport error:      ${firstError}`);
    console.log(`  stock left in db:           ${finalDrop?.stockRemaining}`);
    console.log(`  active holds:               ${holds}`);
    console.log(`  burst p50 / p95 / max:      ${describeTimes(burstTimes)}`);
    console.log(`  burst finished in:          ${Math.round(burstWall)} ms`);
    console.log(`  latecomers p50 / p95 / max: ${describeTimes(lateTimes)}`);
    console.log(`  latecomers finished in:     ${Math.round(lateWall)} ms`);
    console.log(passed ? 'RESULT: PASS' : 'RESULT: FAIL');
    process.exitCode = passed ? 0 : 1;
  } finally {
    await Reservation.deleteMany({ drop: drop._id });
    await Drop.deleteOne({ _id: drop._id });
    await Product.deleteOne({ _id: product._id });
    await mongoose.disconnect();
  }
}

run().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect();
  process.exit(1);
});
