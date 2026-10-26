import { Router } from 'express';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import checkoutRoutes from './checkout.routes';
import dropRoutes from './drop.routes';
import orderRoutes from './order.routes';
import productRoutes from './product.routes';
import reservationRoutes from './reservation.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/drops', dropRoutes);
router.use('/reservations', reservationRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/orders', orderRoutes);
router.use('/admin', adminRoutes);

export default router;
