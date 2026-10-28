import { Router } from 'express';
import {
  adminDropStats,
  adminOverview,
  changeUserRole,
  createDrop,
  createProduct,
  listAdminDrops,
  listAdminProducts,
  listUsers,
  updateDrop,
  updateProduct,
} from '../controllers/admin.controller';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();
const manage = requireRole('admin', 'superadmin');
const superadminOnly = requireRole('superadmin');

router.use(authenticate);

router.get('/overview', manage, adminOverview);
router.get('/drops', manage, listAdminDrops);
router.get('/drops/:id/stats', manage, adminDropStats);
router.post('/drops', manage, createDrop);
router.put('/drops/:id', manage, updateDrop);
router.get('/products', manage, listAdminProducts);
router.post('/products', manage, createProduct);
router.put('/products/:id', manage, updateProduct);

router.get('/users', superadminOnly, listUsers);
router.patch('/users/:id/role', superadminOnly, changeUserRole);

export default router;
