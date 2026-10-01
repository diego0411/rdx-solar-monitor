import { Router } from 'express';
import { getSummary } from '../controllers/dashboard.controller.js';
import { requireModuleAccess } from '../middleware/authorization.middleware.js';

const router = Router();
router.use(requireModuleAccess('dashboard'));
router.get('/summary', getSummary);

export default router;
