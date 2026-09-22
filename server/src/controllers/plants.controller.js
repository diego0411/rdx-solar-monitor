import { listStoredPlants } from '../repositories/plants.repository.js';
import { getPlantsOverview, getPlantOverview } from '../services/plantsOverview.service.js';
import { listPlantEnergySummaries } from '../repositories/plantEnergySummary.repository.js';
import { plantInScope } from '../middleware/authorization.middleware.js';

export async function getPlantDetailOverview(req, res) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.plantId)) {
    return res.status(400).json({ error: 'plantId debe ser un UUID válido' });
  }
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  try {
    const overview = await getPlantOverview(req.params.plantId);
    if (!overview) return res.status(404).json({ error: 'Planta no encontrada' });
    return res.json(overview);
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el detalle de planta' });
  }
}

export async function getOverview(req, res) {
  try {
    return res.json(await getPlantsOverview(req.scope?.plantIds ?? null));
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el resumen por planta' });
  }
}

export async function getPlantEnergySummaries(req, res) {
  try {
    return res.json(await listPlantEnergySummaries(req.scope?.plantIds ?? null));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar los resúmenes energéticos' });
  }
}

export async function getPlants(req, res) {
  try {
    return res.json(await listStoredPlants(req.scope?.plantIds ?? null));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar las plantas almacenadas' });
  }
}
