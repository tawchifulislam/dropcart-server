import { Router } from 'express';
import { createCheckout } from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/:reservationId', authenticate, createCheckout);

export default router;
