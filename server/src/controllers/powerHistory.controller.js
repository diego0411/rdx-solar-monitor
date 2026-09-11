import { syncHyxiPowerHistory } from '../services/hyxiPowerHistory.service.js';
import { listPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';
import { getStoredPlantById } from '../repositories/plants.repository.js';

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export async function postHyxiSyncPowerHistory(req, res) {
  if (!validDate(req.query.startTime)) return res.status(400).json({ error: 'startTime inválido' });
  try {
    const result = await syncHyxiPowerHistory(req.params.plantId, req.query.startTime);
    return res.status(result.failed ? 502 : 200).json(result);
  } catch (error) {
    return res.status(error.statusCode ?? 502).json({ error: error.message });
  }
}

export async function getStoredPowerHistory(req, res) {
  if (!validDate(req.query.startTime)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.plantId)) {
    return res.status(400).json({ error: 'plantId o startTime inválidos' });
  }
  try {
    let rows = await listPlantPowerIntervals(req.params.plantId, req.query.startTime);
    if (!rows.length) {
      const plant = await getStoredPlantById(req.params.plantId);
      if (plant?.provider === 'hyxi' && plant.active && plant.external_plant_id) {
        await syncHyxiPowerHistory(plant.external_plant_id, req.query.startTime);
        rows = await listPlantPowerIntervals(req.params.plantId, req.query.startTime);
      }
    }
    return res.json(rows);
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar la curva de potencia' });
  }
}
