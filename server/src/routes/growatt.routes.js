import { Router } from 'express';
import {
	getGrowattHealth,
	postGrowattRefreshDevicesCache,
	postGrowattSyncDevices,
	postGrowattSyncLatest,
	postGrowattSyncPlants,
} from '../controllers/growatt.controller.js';

const router = Router();

router.get('/health', getGrowattHealth);
router.post('/refresh-devices-cache', postGrowattRefreshDevicesCache);
router.post('/sync/plants', postGrowattSyncPlants);
router.post('/sync/devices', postGrowattSyncDevices);
router.post('/sync/latest', postGrowattSyncLatest);

export default router;