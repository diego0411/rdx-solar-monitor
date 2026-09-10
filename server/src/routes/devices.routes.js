import { Router } from 'express';
import { getDevices, getDevicesLatestData, getDeviceDetail } from '../controllers/devices.controller.js';

const router = Router();
router.get('/', getDevices);
router.get('/latest-data', getDevicesLatestData);
router.get('/:id', getDeviceDetail);

export default router;
