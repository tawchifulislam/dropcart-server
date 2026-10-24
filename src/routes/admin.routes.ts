import { Router } from 'express';
import {
  createDrop,
  createProduct,
  listAdminDrops,
  updateDrop,
  updateProduct,
} from '../controllers/admin.controller';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate, requireAdmin);
router.get('/drops', listAdminDrops);
router.post('/drops', createDrop);
router.put('/drops/:id', updateDrop);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);

export default router;
