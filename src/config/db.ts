import mongoose from 'mongoose';
import { env } from './env';

export async function connectDb() {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });
  await Promise.all(
    mongoose.modelNames().map((name) => mongoose.model(name).init()),
  );
  console.log(`MongoDB connected (database: ${mongoose.connection.name})`);
}
