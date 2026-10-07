import { getStoredPlantById } from '../repositories/plants.repository.js';
import {
  checkPlantSyncable,
  defaultBackfillDeps,
  runEnergyBackfill,
  validateBackfillRange,
} from '../services/energyBackfill.service.js';
import { localDateForTimezone } from '../services/hyxiPowerHistory.service.js';
import { plantInScope } from '../middleware/authorization.middleware.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canRunEnergyBackfill(role) {
  return role === 'rdx_admin' || role === 'client_admin';
}

export async function postEnergyBackfill(req, res) {
  if (!canRunEnergyBackfill(req.profile?.role)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  if (!uuidPattern.test(req.params.plantId ?? '')) {
    return res.status(400).json({ error: 'plantId inválido' });
  }
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  try {
    const plant = await getStoredPlantById(req.params.plantId);
    if (!plant) return res.status(404).json({ error: 'Planta no encontrada' });
    const todayLocal = localDateForTimezone(new Date(), plant.timezone);
    const dates = validateBackfillRange(req.body, todayLocal);
    if (!dates) return res.status(400).json({ error: 'Rango de backfill inválido' });
    const syncable = checkPlantSyncable(plant);
    if (!syncable.ok) return res.status(syncable.status).json({ error: syncable.error });
    const outcome = await runEnergyBackfill({ plant, dates, ...defaultBackfillDeps() });
    if (outcome.aborted) return res.status(429).json(outcome);
    return res.json(outcome);
  } catch {
    return res.status(503).json({ error: 'No se pudo ejecutar el backfill energético' });
  }
}
