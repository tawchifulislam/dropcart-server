import mongoose from 'mongoose';
import { connectDb } from '../config/db';
import { User } from '../models/User';

const ROLES = ['shopper', 'admin'];

async function run() {
  const [email, role = 'admin'] = process.argv.slice(2);
  if (!email || !ROLES.includes(role)) {
    throw new Error(`Usage: npm run set-role -- <email> [${ROLES.join('|')}]`);
  }

  await connectDb();
  const user = await User.findOneAndUpdate(
    { email: email.trim().toLowerCase() },
    { role },
    { new: true },
  );
  if (!user) throw new Error(`No user with the email ${email}`);
  console.log(`${user.email} is now ${user.role}`);
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
