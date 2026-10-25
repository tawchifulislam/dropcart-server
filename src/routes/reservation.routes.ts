import { Router } from 'express';
import { release } from '../controllers/reservation.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.delete('/:id', authenticate, release);

export default router;
