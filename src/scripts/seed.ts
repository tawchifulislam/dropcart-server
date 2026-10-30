import mongoose from 'mongoose';
import { connectDb } from '../config/db';
import { env } from '../config/env';
import { resetDemoData } from '../services/demo.service';

async function seed() {
  if (env.NODE_ENV === 'production' && !env.DEMO_MODE) {
    throw new Error('Refusing to seed a production database');
  }
  await connectDb();
  const result = await resetDemoData();
  console.log(`Seeded ${result.products} products and ${result.drops} drops`);
}

seed()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
