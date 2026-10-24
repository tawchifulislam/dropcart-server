import { Request, Response } from 'express';
import { Drop, DropRecord } from '../models/Drop';
import { Product, ProductRecord } from '../models/Product';
import { dropInput, productInput } from '../schemas/catalog.schema';
import {
  getDropStatus,
  listAllDrops,
  toDropView,
  toProductView,
} from '../services/drop.service';
import { AppError } from '../utils/AppError';
import { isObjectId, slugify } from '../utils/text';

export async function listAdminDrops(_req: Request, res: Response) {
  res.json({ items: await listAllDrops() });
}

export async function createProduct(req: Request, res: Response) {
  const input = productInput.parse(req.body);
  const product = await Product.create({ ...input, slug: slugify(input.name) });
  res.status(201).json(toProductView(product.toObject<ProductRecord>()));
}

export async function updateProduct(
  req: Request<{ id: string }>,
  res: Response,
) {
  const input = productInput.parse(req.body);
  const product = isObjectId(req.params.id)
    ? await Product.findByIdAndUpdate(
        req.params.id,
        { ...input, slug: slugify(input.name) },
        { new: true, runValidators: true },
      ).lean<ProductRecord>()
    : null;
  if (!product) throw new AppError(404, 'Product not found');
  res.json(toProductView(product));
}

export async function createDrop(req: Request, res: Response) {
  const input = dropInput.parse(req.body);
  if (!(await Product.exists({ _id: input.productId }))) {
    throw new AppError(404, 'Product not found');
  }
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
  const input = dropInput.parse(req.body);
  const drop = isObjectId(req.params.id)
    ? await Drop.findById(req.params.id)
    : null;
  if (!drop) throw new AppError(404, 'Drop not found');
  if (getDropStatus(drop, new Date()) !== 'upcoming') {
    throw new AppError(409, 'Only upcoming drops can be edited');
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
