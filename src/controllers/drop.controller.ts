import { Request, Response } from 'express';
import {
  findDrop,
  listLiveDrops,
  listUpcomingDrops,
} from '../services/drop.service';
import { AppError } from '../utils/AppError';
import { isObjectId } from '../utils/text';

export async function getLiveDrops(_req: Request, res: Response) {
  res.json({ items: await listLiveDrops() });
}

export async function getUpcomingDrops(_req: Request, res: Response) {
  res.json({ items: await listUpcomingDrops() });
}

export async function getDrop(req: Request<{ id: string }>, res: Response) {
  const drop = isObjectId(req.params.id) ? await findDrop(req.params.id) : null;
  if (!drop) throw new AppError(404, 'Drop not found');
  res.json(drop);
}
