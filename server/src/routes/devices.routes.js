import { Router } from 'express';
import { getDevices, getDevicesLatestData, getDeviceDetail } from '../controllers/devices.controller.js';
import { requireModuleAccess } from '../middleware/authorization.middleware.js';

const router = Router();
router.use(requireModuleAccess('devices'));
router.get('/', getDevices);
router.get('/latest-data', getDevicesLatestData);
router.get('/:id', getDeviceDetail);

export default router;
