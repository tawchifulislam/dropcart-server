import { Router } from 'express';
import {
  chat,
  clearSession,
  getSession,
} from '../controllers/copilot.controller';
import { authenticate } from '../middleware/auth';
import { copilotLimits } from '../middleware/rate-limit';

const router = Router();

router.get('/session', authenticate, getSession);
router.delete('/session', authenticate, clearSession);
router.post('/chat', authenticate, ...copilotLimits, chat);

export default router;
