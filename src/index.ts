import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { startReservationSweeper } from './services/reservation.service';

async function main() {
  await connectDb();
  startReservationSweeper();
  createApp().listen(env.PORT, () =>
    console.log(`API listening on :${env.PORT}`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
