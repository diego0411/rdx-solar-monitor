import { Router } from 'express';
import { getHyxiPlantAlarms, getHyxiRecentAlarms } from '../controllers/hyxi.controller.js';
import { postHyxiSyncPowerHistory } from '../controllers/powerHistory.controller.js';
import { getHyxiPlantPowerHistory } from '../controllers/hyxi.controller.js';
import { postHyxiSyncEnergyHistory } from '../controllers/energyHistory.controller.js';
import { getHyxiPlantEnergyHistory } from '../controllers/hyxi.controller.js';
import { getHyxiPlantEnergySummary, postHyxiSyncRealtime, postHyxiSyncEnergySummary } from '../controllers/hyxi.controller.js';
import { getHyxiDevice, getHyxiDeviceRealtime, postHyxiSyncDevices, postHyxiSyncDeviceDetails } from '../controllers/hyxi.controller.js';
import { getHyxiHealth, getHyxiPlant, getHyxiPlants, postHyxiSyncPlants, postHyxiSyncPlantDetails } from '../controllers/hyxi.controller.js';
import { requireRoles } from '../middleware/authorization.middleware.js';

const router = Router();

router.get('/health', requireRoles('rdx_admin'), getHyxiHealth);
router.get('/alarms/recent', getHyxiRecentAlarms);
router.post('/sync/realtime', requireRoles('rdx_admin'), postHyxiSyncRealtime);
router.post('/sync/energy-summary', requireRoles('rdx_admin'), postHyxiSyncEnergySummary);
router.get('/devices/:deviceSn', requireRoles('rdx_admin'), getHyxiDevice);
router.get('/devices/:deviceSn/realtime', requireRoles('rdx_admin'), getHyxiDeviceRealtime);
router.get('/plants', requireRoles('rdx_admin'), getHyxiPlants);
router.get('/plants/:plantId', requireRoles('rdx_admin'), getHyxiPlant);
router.get('/plants/:plantId/alarms', requireRoles('rdx_admin'), getHyxiPlantAlarms);
router.get('/plants/:plantId/energy-summary', requireRoles('rdx_admin'), getHyxiPlantEnergySummary);
router.get('/plants/:plantId/energy-history', requireRoles('rdx_admin'), getHyxiPlantEnergyHistory);
router.get('/plants/:plantId/power-history', requireRoles('rdx_admin'), getHyxiPlantPowerHistory);
router.post('/plants/:plantId/sync/energy-history', requireRoles('rdx_admin'), postHyxiSyncEnergyHistory);
router.post('/plants/:plantId/sync/power-history', requireRoles('rdx_admin'), postHyxiSyncPowerHistory);
router.post('/sync/plants', requireRoles('rdx_admin'), postHyxiSyncPlants);
router.post('/sync/devices', requireRoles('rdx_admin'), postHyxiSyncDevices);
router.post('/sync/device-details', requireRoles('rdx_admin'), postHyxiSyncDeviceDetails);
router.post('/sync/plant-details', requireRoles('rdx_admin'), postHyxiSyncPlantDetails);

export default router;
