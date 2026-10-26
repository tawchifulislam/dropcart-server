import { Router } from 'express';
import { listMine, release } from '../controllers/reservation.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/mine', authenticate, listMine);
router.delete('/:id', authenticate, release);

export default router;
