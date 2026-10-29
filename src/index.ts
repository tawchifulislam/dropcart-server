import mongoose from 'mongoose';
import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { startReservationSweeper } from './services/reservation.service';

async function main() {
  await connectDb();
  const sweeper = startReservationSweeper();

  const server = createApp().listen(env.PORT, () => {
    console.log(
      `API listening on :${env.PORT} (${env.NODE_ENV}, payments: ${env.PAYMENT_PROVIDER})`,
    );
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    clearInterval(sweeper);
    server.close(() => {
      mongoose.disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
