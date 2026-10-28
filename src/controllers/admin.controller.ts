import { Request, Response } from 'express';
import { z } from 'zod';
import { type Actor, currentActor } from '../middleware/auth';
import { Drop, DropRecord } from '../models/Drop';
import { Product, ProductRecord } from '../models/Product';
import { ROLES } from '../models/User';
import { dropInput, productInput } from '../schemas/catalog.schema';
import {
  getDropStats,
  getOverview,
  listManagedProducts,
  listScopedDrops,
  listUsers as findUsers,
  setUserRole,
} from '../services/admin.service';
import {
  getDropStatus,
  toDropView,
  toProductView,
} from '../services/drop.service';
import { assertManagesProduct, productScope } from '../services/scope';
import { AppError } from '../utils/AppError';
import { isObjectId, slugify } from '../utils/text';

async function uniqueSlug(name: string) {
  const base = slugify(name) || 'product';
  let slug = base;
  let attempt = 1;
  while (await Product.exists({ slug })) {
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
  return slug;
}

const productId = (id: string) => {
  if (!isObjectId(id))
    throw new AppError(404, 'Product not found', 'NOT_FOUND');
  return id;
};

export async function adminOverview(req: Request, res: Response) {
  res.json(await getOverview(currentActor(req)));
}

export async function adminDropStats(
  req: Request<{ id: string }>,
  res: Response,
) {
  res.json(await getDropStats(currentActor(req), req.params.id));
}

export async function listAdminDrops(req: Request, res: Response) {
  res.json({ items: await listScopedDrops(currentActor(req)) });
}

export async function listAdminProducts(req: Request, res: Response) {
  res.json({ items: await listManagedProducts(currentActor(req)) });
}

export async function createProduct(req: Request, res: Response) {
  const actor = currentActor(req);
  const input = productInput.parse(req.body);
  const product = await Product.create({
    ...input,
    slug: await uniqueSlug(input.name),
    owner: actor.id,
  });
  res.status(201).json(toProductView(product.toObject<ProductRecord>()));
}

export async function updateProduct(
  req: Request<{ id: string }>,
  res: Response,
) {
  const actor = currentActor(req);
  const input = productInput.parse(req.body);
  const product = await Product.findOneAndUpdate(
    { _id: productId(req.params.id), ...productScope(actor) },
    input,
    { new: true, runValidators: true },
  ).lean<ProductRecord>();
  if (!product) throw new AppError(404, 'Product not found', 'NOT_FOUND');
  res.json(toProductView(product));
}

async function requireManagedDrop(actor: Actor, id: string) {
  const drop = isObjectId(id) ? await Drop.findById(id) : null;
  if (!drop) throw new AppError(404, 'Drop not found', 'NOT_FOUND');
  await assertManagesProduct(actor, drop.product.toString());
  return drop;
}

export async function createDrop(req: Request, res: Response) {
  const actor = currentActor(req);
  const input = dropInput.parse(req.body);
  await assertManagesProduct(actor, input.productId);
  const drop = await Drop.create({
    product: input.productId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    dropPrice: input.dropPrice,
    stockTotal: input.stockTotal,
    stockRemaining: input.stockTotal,
  });
  res.status(201).json(toDropView(drop.toObject<DropRecord>()));
}

export async function updateDrop(req: Request<{ id: string }>, res: Response) {
  const actor = currentActor(req);
  const input = dropInput.parse(req.body);
  const drop = await requireManagedDrop(actor, req.params.id);
  await assertManagesProduct(actor, input.productId);
  if (getDropStatus(drop, new Date()) !== 'upcoming') {
    throw new AppError(409, 'Only upcoming drops can be edited', 'DROP_LOCKED');
  }
  drop.set({
    product: input.productId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    dropPrice: input.dropPrice,
    stockTotal: input.stockTotal,
    stockRemaining: input.stockTotal,
  });
  await drop.save();
  res.json(toDropView(drop.toObject<DropRecord>()));
}

const usersQuery = z.object({ search: z.string().trim().max(100).optional() });
const roleBody = z.object({ role: z.enum(ROLES) });

export async function listUsers(req: Request, res: Response) {
  const { search } = usersQuery.parse(req.query);
  res.json({ items: await findUsers(search) });
}

export async function changeUserRole(
  req: Request<{ id: string }>,
  res: Response,
) {
  const { role } = roleBody.parse(req.body);
  res.json(await setUserRole(currentActor(req).id, req.params.id, role));
}
