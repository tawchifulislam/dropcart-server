import { Router } from 'express';
import {
  getDrop,
  getLiveDrops,
  getUpcomingDrops,
} from '../controllers/drop.controller';

const router = Router();

router.get('/live', getLiveDrops);
router.get('/upcoming', getUpcomingDrops);
router.get('/:id', getDrop);

export default router;
