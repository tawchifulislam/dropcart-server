import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { AUTH_COOKIE } from '../src/middleware/auth';
import { Drop } from '../src/models/Drop';
import { Product } from '../src/models/Product';
import { type Role, User } from '../src/models/User';

export const app = createApp();

let counter = 0;
const nextNumber = () => {
  counter += 1;
  return counter;
};

export const newId = () => new Types.ObjectId().toString();

export const cookieFor = (userId: string) =>
  `${AUTH_COOKIE}=${jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: 600 })}`;

export async function createUser(role: Role = 'shopper') {
  const n = nextNumber();
  const user = await User.create({
    name: `User ${n}`,
    email: `user${n}@example.com`,
    passwordHash: 'not-a-real-hash',
    role,
  });
  return { id: user.id as string, cookie: cookieFor(user.id) };
}

interface ProductOptions {
  owner?: string;
  name?: string;
  category?: string;
  description?: string;
  basePrice?: number;
}

export async function createProduct(options: ProductOptions = {}) {
  const n = nextNumber();
  const name = options.name ?? `Product ${n}`;
  return Product.create({
    name,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${n}`,
    description: options.description ?? 'A product used in tests.',
    category: options.category ?? 'Test',
    basePrice: options.basePrice ?? 1000,
    ...(options.owner ? { owner: options.owner } : {}),
  });
}

export interface DropOptions {
  stock?: number;
  remaining?: number;
  price?: number;
  startsInMs?: number;
  endsInMs?: number;
}

export function createDrop(productId: string, options: DropOptions = {}) {
  const stock = options.stock ?? 10;
  const now = Date.now();
  return Drop.create({
    product: productId,
    startsAt: new Date(now + (options.startsInMs ?? -60_000)),
    endsAt: new Date(now + (options.endsInMs ?? 3_600_000)),
    dropPrice: options.price ?? 500,
    stockTotal: stock,
    stockRemaining: options.remaining ?? stock,
  });
}
export async function createLiveDrop(options: DropOptions = {}) {
  const product = await createProduct();
  return createDrop(product.id, options);
}

export async function stockOf(dropId: string) {
  return (await Drop.findById(dropId).lean())?.stockRemaining;
}
