import { Router } from 'express';
import { scheduledReset } from '../controllers/demo.controller';

const router = Router();

router.post('/reset', scheduledReset);

export default router;
