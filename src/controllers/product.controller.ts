import { Request, Response } from 'express';
import { z } from 'zod';
import { Product, ProductRecord } from '../models/Product';
import { attachActiveDrops } from '../services/drop.service';
import { AppError } from '../utils/AppError';
import { escapeRegExp, isObjectId } from '../utils/text';

const listQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

export async function listProducts(req: Request, res: Response) {
  const query = listQuery.parse(req.query);
  const filter: Record<string, unknown> = {};
  if (query.category) filter.category = query.category;
  if (query.search) {
    const pattern = new RegExp(escapeRegExp(query.search), 'i');
    filter.$or = [{ name: pattern }, { description: pattern }];
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ProductRecord[]>(),
    Product.countDocuments(filter),
  ]);

  res.json({
    items: await attachActiveDrops(products),
    total,
    page: query.page,
    limit: query.limit,
  });
}

export async function listCategories(_req: Request, res: Response) {
  const categories = await Product.distinct('category');
  res.json({ items: categories.sort() });
}

export async function getProduct(
  req: Request<{ idOrSlug: string }>,
  res: Response,
) {
  const { idOrSlug } = req.params;
  const product = await Product.findOne(
    isObjectId(idOrSlug) ? { _id: idOrSlug } : { slug: idOrSlug },
  ).lean<ProductRecord>();
  if (!product) throw new AppError(404, 'Product not found');
  const [view] = await attachActiveDrops([product]);
  res.json(view);
}
