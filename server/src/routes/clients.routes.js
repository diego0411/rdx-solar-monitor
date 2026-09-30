import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { loadProfile, requireRoles } from '../middleware/authorization.middleware.js';
import {
  getClients,
  patchClient,
  patchClientStatus,
  postClient,
} from '../controllers/clients.controller.js';

const router = Router();

router.use(requireAuth, loadProfile, requireRoles('rdx_admin'));

router.get('/', getClients);
router.post('/', postClient);
router.patch('/:id/status', patchClientStatus);
router.patch('/:id', patchClient);

export default router;
