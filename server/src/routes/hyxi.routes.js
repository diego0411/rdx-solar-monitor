import { Router } from 'express';
import { getHyxiPlantAlarms } from '../controllers/hyxi.controller.js';
import { postHyxiSyncPowerHistory } from '../controllers/powerHistory.controller.js';
import { getHyxiPlantPowerHistory } from '../controllers/hyxi.controller.js';
import { postHyxiSyncEnergyHistory } from '../controllers/energyHistory.controller.js';
import { getHyxiPlantEnergyHistory } from '../controllers/hyxi.controller.js';
import { getHyxiPlantEnergySummary, postHyxiSyncRealtime, postHyxiSyncEnergySummary } from '../controllers/hyxi.controller.js';
import { getHyxiDevice, getHyxiDeviceRealtime, postHyxiSyncDevices, postHyxiSyncDeviceDetails } from '../controllers/hyxi.controller.js';
import { getHyxiHealth, getHyxiPlant, getHyxiPlants, postHyxiSyncPlants, postHyxiSyncPlantDetails } from '../controllers/hyxi.controller.js';

const router = Router();

router.get('/health', getHyxiHealth);
router.post('/sync/realtime', postHyxiSyncRealtime);
router.post('/sync/energy-summary', postHyxiSyncEnergySummary);
router.get('/devices/:deviceSn', getHyxiDevice);
router.get('/devices/:deviceSn/realtime', getHyxiDeviceRealtime);
router.get('/plants', getHyxiPlants);
router.get('/plants/:plantId', getHyxiPlant);
router.get('/plants/:plantId/alarms', getHyxiPlantAlarms);
router.get('/plants/:plantId/energy-summary', getHyxiPlantEnergySummary);
router.get('/plants/:plantId/energy-history', getHyxiPlantEnergyHistory);
router.get('/plants/:plantId/power-history', getHyxiPlantPowerHistory);
router.post('/plants/:plantId/sync/energy-history', postHyxiSyncEnergyHistory);
router.post('/plants/:plantId/sync/power-history', postHyxiSyncPowerHistory);
router.post('/sync/plants', postHyxiSyncPlants);
router.post('/sync/devices', postHyxiSyncDevices);
router.post('/sync/device-details', postHyxiSyncDeviceDetails);
router.post('/sync/plant-details', postHyxiSyncPlantDetails);

export default router;
