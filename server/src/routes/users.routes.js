import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { loadProfile, requireRoles } from '../middleware/authorization.middleware.js';
import { getUsers, postUsers, patchUser, patchUserStatus } from '../controllers/users.controller.js';

const router = Router();

router.use(requireAuth, loadProfile, requireRoles('rdx_admin', 'client_admin'));

router.get('/', getUsers);
router.post('/', postUsers);
router.patch('/:id', patchUser);
router.patch('/:id/status', patchUserStatus);

export default router;
