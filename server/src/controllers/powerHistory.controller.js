import { syncHyxiPowerHistory } from '../services/hyxiPowerHistory.service.js';
import { listPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';
import { getStoredPlantById } from '../repositories/plants.repository.js';
import { syncGrowattPowerHistory } from '../services/growattPowerHistory.service.js';
import { plantInScope } from '../middleware/authorization.middleware.js';

const powerFields = [
  'generation_power_w', 'consumption_power_w', 'grid_import_power_w',
  'grid_export_power_w', 'battery_charge_power_w', 'battery_discharge_power_w',
];

function hasPowerValues(rows) {
  return rows.some(row => powerFields.some(field => row[field] !== null
    && row[field] !== undefined && Number.isFinite(Number(row[field]))));
}

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
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  try {
    let rows = await listPlantPowerIntervals(req.params.plantId, req.query.startTime);
    if (!hasPowerValues(rows)) {
      const plant = await getStoredPlantById(req.params.plantId);
      if (plant?.provider === 'hyxi' && plant.active && plant.external_plant_id) {
        if (!rows.length) await syncHyxiPowerHistory(plant.external_plant_id, req.query.startTime);
      } else if (plant?.provider === 'growatt' && plant.active) {
        await syncGrowattPowerHistory(plant, req.query.startTime);
      }
      rows = await listPlantPowerIntervals(req.params.plantId, req.query.startTime);
    }
    return res.json(rows);
  } catch (error) {
    if (error?.frequentAccess) return res.status(503).json({ error: 'FREQUENTLY_ACCESS' });
    return res.status(503).json({ error: 'No se pudo consultar la curva de potencia' });
  }
}
