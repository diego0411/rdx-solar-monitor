import { Router } from 'express';
import { getDevices, getDevicesLatestData, getDeviceDetail, getDevicesCatalog } from '../controllers/devices.controller.js';
import { requireModuleAccess } from '../middleware/authorization.middleware.js';

const router = Router();
router.use(requireModuleAccess('devices'));
router.get('/', getDevices);
router.get('/latest-data', getDevicesLatestData);
// Antes de /:id: 'catalog' debe resolver al catálogo, no a detalle.
router.get('/catalog', getDevicesCatalog);
router.get('/:id', getDeviceDetail);

export default router;
