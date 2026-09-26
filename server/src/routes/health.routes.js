import { Router } from 'express';
import { getHealth, getDatabaseHealth } from '../controllers/health.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { loadProfile, requireRoles } from '../middleware/authorization.middleware.js';

const router = Router();

// Health check mínimo: público a propósito (Render/monitoreo).
router.get('/', getHealth);
// Diagnóstico de BD: solo rdx_admin autenticado; sin nombres de tablas.
router.get('/database', requireAuth, loadProfile, requireRoles('rdx_admin'), getDatabaseHealth);

export default router;
