import { Router } from 'express';
import {
	getGrowattCurrentAlarms,
	getGrowattHealth,
	postGrowattRefreshDevicesCache,
	postGrowattSyncDevices,
	postGrowattSyncLatest,
	postGrowattSyncPlants,
} from '../controllers/growatt.controller.js';
import { requireRoles } from '../middleware/authorization.middleware.js';

const router = Router();
router.get('/alarms/current', getGrowattCurrentAlarms);

/*
 * Maintenance de integración: solo rdx_admin puede orquestar
 * sincronizaciones, refrescar cachés o reconfigurar. Monitoreo
 * (alarms/current, health) queda disponible para perfiles con
 * alcance.
 */
router.get('/health', requireRoles('rdx_admin'), getGrowattHealth);
router.post('/refresh-devices-cache',
	requireRoles('rdx_admin'), postGrowattRefreshDevicesCache);
router.post('/sync/plants',
	requireRoles('rdx_admin'), postGrowattSyncPlants);
router.post('/sync/devices',
	requireRoles('rdx_admin'), postGrowattSyncDevices);
router.post('/sync/latest',
	requireRoles('rdx_admin'), postGrowattSyncLatest);

export default router;
