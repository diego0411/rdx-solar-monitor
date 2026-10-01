import { Router } from 'express';
import {
  deleteActivity,
  getMaintenance,
  listMaintenance,
  patchActivity,
  patchMaintenance,
  patchMaintenanceStatus,
  postActivity,
  postMaintenance,
} from '../controllers/maintenance.controller.js';
import { requireModuleAccess, requireRoles } from '../middleware/authorization.middleware.js';

const writer = requireRoles('rdx_admin', 'client_admin');

const router = Router();
router.use(requireModuleAccess('maintenance'));
router.get('/', listMaintenance);
router.get('/:id', getMaintenance);
router.post('/', writer, postMaintenance);
router.patch('/:id', writer, patchMaintenance);
router.patch('/:id/status', writer, patchMaintenanceStatus);
router.post('/:id/activities', writer, postActivity);
router.patch('/:id/activities/:activityId', writer, patchActivity);
router.delete('/:id/activities/:activityId', writer, deleteActivity);

export default router;
