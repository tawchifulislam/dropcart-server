import { Router } from 'express';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import dropRoutes from './drop.routes';
import productRoutes from './product.routes';
import reservationRoutes from './reservation.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/drops', dropRoutes);
router.use('/reservations', reservationRoutes);
router.use('/admin', adminRoutes);

export default router;
