import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';

async function main() {
  await connectDb();
  createApp().listen(env.PORT, () =>
    console.log(`API listening on :${env.PORT}`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
