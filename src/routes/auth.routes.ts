import { Router } from 'express';
import {
  guest,
  login,
  logout,
  me,
  register,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { guestLimit } from '../middleware/rate-limit';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/guest', guestLimit, guest);
router.post('/logout', logout);
router.get('/me', authenticate, me);

export default router;
