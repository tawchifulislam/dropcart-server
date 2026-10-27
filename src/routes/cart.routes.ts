import { Router } from 'express';
import {
  addCartItem,
  listCart,
  removeCartItem,
} from '../controllers/cart.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, listCart);
router.post('/items', authenticate, addCartItem);
router.delete('/items/:productId', authenticate, removeCartItem);

export default router;
