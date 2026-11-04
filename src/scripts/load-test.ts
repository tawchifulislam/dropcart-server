import jwt from "jsonwebtoken";
import mongoose, { Types } from "mongoose";
import { connectDb } from "../config/db";
import { env } from "../config/env";
import { AUTH_COOKIE } from "../middleware/auth";
import { Drop } from "../models/Drop";
import { Product } from "../models/Product";
import { Reservation } from "../models/Reservation";

const BASE_URL = process.env.LOAD_TEST_URL ?? `http://localhost:${env.PORT}`;
const STOCK = Number(process.env.LOAD_TEST_STOCK ?? 10);
const BUYERS = Number(process.env.LOAD_TEST_BUYERS ?? 200);

async function fire(dropId: string) {
  const token = jwt.sign({ sub: new Types.ObjectId().toString(), role: "shopper" }, env.JWT_SECRET, {
    expiresIn: 600,
  });
  const started = performance.now();
  const response = await fetch(`${BASE_URL}/drops/${dropId}/reserve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `${AUTH_COOKIE}=${token}` },
    body: "{}",
  });
  await response.text();
  return { status: response.status, ms: performance.now() - started };
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function run() {
  await connectDb();
  const stamp = Date.now();
  const product = await Product.create({
    name: `Load test ${stamp}`,
    slug: `load-test-${stamp}`,
    description: "Temporary product for the reservation load test.",
    category: "Test",
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
    const results = await Promise.all(Array.from({ length: BUYERS }, () => fire(drop.id)));
    const wall = performance.now() - burstStarted;

    const reserved = results.filter((result) => result.status === 201).length;
    const soldOut = results.filter((result) => result.status === 409).length;
    const other = BUYERS - reserved - soldOut;
    const times = results.map((result) => result.ms).sort((a, b) => a - b);
    const finalDrop = await Drop.findById(drop._id).lean();
    const holds = await Reservation.countDocuments({ drop: drop._id, status: "active" });

    const passed =
      reserved === STOCK &&
      soldOut === BUYERS - STOCK &&
      other === 0 &&
      finalDrop?.stockRemaining === 0 &&
      holds === STOCK;

    console.log("Reservation load test");
    console.log(`  stock ${STOCK}, simultaneous buyers ${BUYERS}`);
    console.log(`  201 reserved:      ${reserved}`);
    console.log(`  409 sold out:      ${soldOut}`);
    console.log(`  unexpected:        ${other}`);
    console.log(`  stock left in db:  ${finalDrop?.stockRemaining}`);
    console.log(`  active holds:      ${holds}`);
    console.log(
      `  p50 / p95 / max:   ${Math.round(percentile(times, 50))} / ${Math.round(
        percentile(times, 95)
      )} / ${Math.round(times[times.length - 1])} ms`
    );
    console.log(`  all finished in:   ${Math.round(wall)} ms`);
    console.log(passed ? "RESULT: PASS" : "RESULT: FAIL");
    process.exitCode = passed ? 0 : 1;
  } finally {
    await Reservation.deleteMany({ drop: drop._id });
    await Drop.deleteOne({ _id: drop._id });
    await Product.deleteOne({ _id: product._id });
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});