import { Router } from 'express';
import {
  getReservation,
  listMine,
  release,
} from '../controllers/reservation.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/mine', authenticate, listMine);
router.get('/:id', authenticate, getReservation);
router.delete('/:id', authenticate, release);

export default router;
