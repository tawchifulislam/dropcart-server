import { Drop, DropRecord } from '../models/Drop';
import { Product, ProductRecord } from '../models/Product';

export type DropStatus = 'upcoming' | 'live' | 'ended';

export function getDropStatus(
  drop: Pick<DropRecord, 'startsAt' | 'endsAt'>,
  now: Date,
): DropStatus {
  if (now < drop.startsAt) return 'upcoming';
  if (now >= drop.endsAt) return 'ended';
  return 'live';
}

export function toDropView(drop: DropRecord, now = new Date()) {
  return {
    id: drop._id.toString(),
    productId: drop.product.toString(),
    startsAt: drop.startsAt,
    endsAt: drop.endsAt,
    dropPrice: drop.dropPrice,
    stockTotal: drop.stockTotal,
    stockRemaining: drop.stockRemaining,
    status: getDropStatus(drop, now),
    soldOut: drop.stockRemaining === 0,
  };
}

export function toProductView(product: ProductRecord) {
  return {
    id: product._id.toString(),
    name: product.name,
    slug: product.slug,
    description: product.description,
    category: product.category,
    images: product.images,
    variants: product.variants.map(({ label, sku }) => ({ label, sku })),
    specs: product.specs,
    basePrice: product.basePrice,
  };
}

export async function withProducts(drops: DropRecord[], now: Date) {
  const products = await Product.find({
    _id: { $in: drops.map((drop) => drop.product) },
  }).lean<ProductRecord[]>();
  const byId = new Map(
    products.map((product) => [product._id.toString(), product]),
  );

  return drops.flatMap((drop) => {
    const product = byId.get(drop.product.toString());
    return product
      ? [{ ...toDropView(drop, now), product: toProductView(product) }]
      : [];
  });
}

export async function listLiveDrops() {
  const now = new Date();
  const drops = await Drop.find({
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .sort({ endsAt: 1 })
    .lean<DropRecord[]>();
  return withProducts(drops, now);
}

export async function listUpcomingDrops(limit = 12) {
  const now = new Date();
  const drops = await Drop.find({ startsAt: { $gt: now } })
    .sort({ startsAt: 1 })
    .limit(limit)
    .lean<DropRecord[]>();
  return withProducts(drops, now);
}

export async function listAllDrops(limit = 100) {
  const drops = await Drop.find()
    .sort({ startsAt: -1 })
    .limit(limit)
    .lean<DropRecord[]>();
  return withProducts(drops, new Date());
}

export async function findDrop(id: string) {
  const drop = await Drop.findById(id).lean<DropRecord>();
  if (!drop) return null;
  const [view] = await withProducts([drop], new Date());
  return view ?? null;
}

export async function attachActiveDrops(products: ProductRecord[]) {
  const now = new Date();
  const drops = await Drop.find({
    product: { $in: products.map((product) => product._id) },
    endsAt: { $gt: now },
  })
    .sort({ startsAt: 1 })
    .lean<DropRecord[]>();

  const nextByProduct = new Map<string, DropRecord>();
  for (const drop of drops) {
    const key = drop.product.toString();
    if (!nextByProduct.has(key)) nextByProduct.set(key, drop);
  }

  return products.map((product) => {
    const drop = nextByProduct.get(product._id.toString());
    return {
      ...toProductView(product),
      drop: drop ? toDropView(drop, now) : null,
    };
  });
}
