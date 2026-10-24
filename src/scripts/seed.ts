import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDb } from '../config/db';
import { Drop } from '../models/Drop';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { slugify } from '../utils/text';

const HOUR = 60 * 60 * 1000;
const fromNow = (hours: number) => new Date(Date.now() + hours * HOUR);

const products = [
  {
    name: 'Rain Day Shell Jacket',
    category: 'Clothing',
    description:
      'Seam-sealed waterproof shell with a packable hood and a relaxed everyday fit.',
    basePrice: 2500,
    variants: ['S', 'M', 'L', 'XL'].map((label) => ({
      label,
      sku: `RDSJ-${label}`,
    })),
    specs: { material: 'Recycled nylon', fit: 'Regular' },
  },
  {
    name: 'Cotton Everyday Tote',
    category: 'Accessories',
    description:
      'Heavy cotton tote with a reinforced base and an inner zip pocket.',
    basePrice: 800,
    specs: { material: 'Organic cotton', capacity: '18 L' },
  },
  {
    name: 'Canvas Crab Bag',
    category: 'Accessories',
    description:
      'Waxed canvas crossbody bag with a magnetic flap and adjustable strap.',
    basePrice: 1600,
    specs: { material: 'Waxed canvas' },
  },
  {
    name: 'Ceramic Tea Cup Set',
    category: 'Home',
    description:
      'Set of four hand-glazed ceramic cups with a matching serving tray.',
    basePrice: 1200,
    specs: { pieces: '4 cups, 1 tray' },
  },
  {
    name: 'Soy Wax Candle Trio',
    category: 'Gifts',
    description: 'Three slow-burning soy candles in reusable glass jars.',
    basePrice: 900,
    specs: { burnTime: '30 hours each' },
  },
  {
    name: 'Linen Overshirt',
    category: 'Clothing',
    description: 'Washed linen overshirt with chest pockets and a boxy cut.',
    basePrice: 1990,
    variants: ['M', 'L', 'XL'].map((label) => ({ label, sku: `LOS-${label}` })),
    specs: { material: '100% linen' },
  },
  {
    name: 'Handloom Scarf',
    category: 'Accessories',
    description: 'Lightweight handloom cotton scarf woven in small batches.',
    basePrice: 1100,
    specs: { material: 'Handloom cotton' },
  },
  {
    name: 'Folding Umbrella',
    category: 'Accessories',
    description: 'Compact windproof umbrella with a reflective trim.',
    basePrice: 850,
    specs: { ribs: '8' },
  },
];

async function seed() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to seed');
  }

  await connectDb();
  await Promise.all([Product.deleteMany({}), Drop.deleteMany({})]);

  await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    {
      name: 'DropCart Admin',
      passwordHash: await bcrypt.hash(password, 12),
      role: 'admin',
    },
    { upsert: true },
  );

  const created = await Product.insertMany(
    products.map((product) => ({ ...product, slug: slugify(product.name) })),
  );
  const idByName = new Map(
    created.map((product) => [product.name, product._id]),
  );
  const productId = (name: string) => {
    const id = idByName.get(name);
    if (!id) throw new Error(`Unknown seed product: ${name}`);
    return id;
  };

  const drops = [
    {
      name: 'Rain Day Shell Jacket',
      starts: -1,
      ends: 72,
      price: 1850,
      total: 10,
      remaining: 7,
    },
    {
      name: 'Cotton Everyday Tote',
      starts: -0.5,
      ends: 96,
      price: 550,
      total: 30,
      remaining: 12,
    },
    {
      name: 'Canvas Crab Bag',
      starts: 4,
      ends: 52,
      price: 1250,
      total: 20,
      remaining: 20,
    },
    {
      name: 'Ceramic Tea Cup Set',
      starts: 20,
      ends: 68,
      price: 950,
      total: 15,
      remaining: 15,
    },
    {
      name: 'Soy Wax Candle Trio',
      starts: 72,
      ends: 120,
      price: 700,
      total: 25,
      remaining: 25,
    },
    {
      name: 'Linen Overshirt',
      starts: -50,
      ends: -46,
      price: 1490,
      total: 10,
      remaining: 0,
    },
  ];

  await Drop.insertMany(
    drops.map((drop) => ({
      product: productId(drop.name),
      startsAt: fromNow(drop.starts),
      endsAt: fromNow(drop.ends),
      dropPrice: drop.price,
      stockTotal: drop.total,
      stockRemaining: drop.remaining,
    })),
  );

  console.log(`Seeded ${created.length} products and ${drops.length} drops`);
}

seed()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
