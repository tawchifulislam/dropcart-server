import mongoose from 'mongoose';
import { connectDb } from '../config/db';
import { env } from '../config/env';

const PROTECTED = ['admin', 'local', 'config'];

async function run() {
  if (env.NODE_ENV === 'production')
    throw new Error('Refusing to reset a production database');
  if (PROTECTED.includes(env.MONGODB_DB)) {
    throw new Error(`Refusing to drop the system database "${env.MONGODB_DB}"`);
  }
  if (!process.argv.includes('--yes')) {
    throw new Error(
      `This drops the whole "${env.MONGODB_DB}" database. Run again with --yes to confirm.`,
    );
  }

  await connectDb();
  await mongoose.connection.dropDatabase();
  console.log(`Dropped database "${env.MONGODB_DB}"`);
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
