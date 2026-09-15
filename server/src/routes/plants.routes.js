import { Router } from 'express';
import { getStoredPowerHistory } from '../controllers/powerHistory.controller.js';
import { getStoredEnergyHistory } from '../controllers/energyHistory.controller.js';
import { getPlants, getPlantEnergySummaries, getOverview, getPlantDetailOverview } from '../controllers/plants.controller.js';
import { getPlantFinancial, putPlantFinancial } from '../controllers/plantFinancial.controller.js';

const router = Router();
router.get('/', getPlants);
router.get('/overview', getOverview);
router.get('/:plantId/overview', getPlantDetailOverview);
router.get('/:plantId/financial', getPlantFinancial);
router.put('/:plantId/financial', putPlantFinancial);
router.get('/energy-summary', getPlantEnergySummaries);
router.get('/:plantId/energy-history', getStoredEnergyHistory);
router.get('/:plantId/power-history', getStoredPowerHistory);

export default router;
