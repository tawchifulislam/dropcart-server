import { Router } from 'express';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import checkoutRoutes from './checkout.routes';
import dropRoutes from './drop.routes';
import orderRoutes from './order.routes';
import productRoutes from './product.routes';
import reservationRoutes from './reservation.routes';
import cartRoutes from './cart.routes';
import copilotRoutes from './copilot.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/drops', dropRoutes);
router.use('/reservations', reservationRoutes);
router.use('/checkout', checkoutRoutes);
router.use('/orders', orderRoutes);
router.use('/admin', adminRoutes);
router.use('/cart', cartRoutes);
router.use('/copilot', copilotRoutes);

export default router;
