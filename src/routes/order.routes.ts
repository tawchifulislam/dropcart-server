import { Router } from 'express';
import { getOrder, mockConfirm } from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/:id', authenticate, getOrder);
router.post('/:id/mock-confirm', authenticate, mockConfirm);

export default router;
