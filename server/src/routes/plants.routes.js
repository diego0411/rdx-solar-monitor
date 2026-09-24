import { Router } from 'express';
import { getStoredPowerHistory } from '../controllers/powerHistory.controller.js';
import { getStoredEnergyHistory } from '../controllers/energyHistory.controller.js';
import { getPlants, getPlantEnergySummaries, getOverview, getPlantDetailOverview } from '../controllers/plants.controller.js';
import { getPlantFinancial, putPlantFinancial } from '../controllers/plantFinancial.controller.js';
import {
  getPlantEconomicSummaryController,
  getPlantEnergyTariffs,
  patchPlantEnergyTariff,
  postPlantEnergyTariff,
} from '../controllers/plantEconomics.controller.js';
import { requireRoles } from '../middleware/authorization.middleware.js';
import {
  getInstallationDetails,
  putInstallationDetails,
} from '../controllers/plantInstallationDetails.controller.js';

const router = Router();
router.get('/', getPlants);
router.get('/overview', getOverview);
router.get('/:plantId/overview', getPlantDetailOverview);
router.get('/:plantId/installation-details', getInstallationDetails);
router.put('/:plantId/installation-details', requireRoles('rdx_admin', 'client_admin'), putInstallationDetails);
router.get('/:plantId/financial', getPlantFinancial);
router.put('/:plantId/financial', putPlantFinancial);
router.get('/:plantId/energy-tariffs', getPlantEnergyTariffs);
router.post('/:plantId/energy-tariffs', requireRoles('rdx_admin', 'client_admin'), postPlantEnergyTariff);
router.patch('/:plantId/energy-tariffs/:tariffId', requireRoles('rdx_admin', 'client_admin'), patchPlantEnergyTariff);
router.get('/:plantId/economics', getPlantEconomicSummaryController);
router.get('/energy-summary', getPlantEnergySummaries);
router.get('/:plantId/energy-history', getStoredEnergyHistory);
router.get('/:plantId/power-history', getStoredPowerHistory);

export default router;
