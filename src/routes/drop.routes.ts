import { Router } from 'express';
import {
  getDrop,
  getLiveDrops,
  getUpcomingDrops,
} from '../controllers/drop.controller';
import {
  getMyReservation,
  reserve,
} from '../controllers/reservation.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/live', getLiveDrops);
router.get('/upcoming', getUpcomingDrops);
router.get('/:id', getDrop);
router.post('/:id/reserve', authenticate, reserve);
router.get('/:id/reservation', authenticate, getMyReservation);

export default router;
