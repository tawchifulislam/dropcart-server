import { Router } from 'express';
import {
  guest,
  login,
  logout,
  me,
  register,
  session,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { guestLimit, loginLimit } from '../middleware/rate-limit';

const router = Router();

router.post('/register', register);
router.post('/login', loginLimit, login);
router.post('/guest', guestLimit, guest);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.get('/session', session);

export default router;
