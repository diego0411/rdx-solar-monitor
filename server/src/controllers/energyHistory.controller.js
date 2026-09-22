import { syncHyxiEnergyHistory } from '../services/hyxiEnergyHistory.service.js';
import { syncGrowattEnergyHistory } from '../services/growattEnergyHistory.service.js';
import { listEnergyIntervals } from '../repositories/energyIntervals.repository.js';
import { getStoredPlantById } from '../repositories/plants.repository.js';
import { plantInScope } from '../middleware/authorization.middleware.js';

function validQuery({ timeType, startTime }) {
  return typeof timeType === 'string' && /^[123]$/.test(timeType)
    && typeof startTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startTime)
    && Number.isFinite(Date.parse(startTime))
    && new Date(startTime).toISOString().slice(0, 10) === startTime;
}

function hasEnergyValues(rows) {
  return rows.some(row => [
    row.generation_kwh,
    row.consumption_kwh,
    row.grid_import_kwh,
    row.grid_export_kwh,
  ].some(value => value !== null && value !== undefined && String(value).trim() !== ''
    && Number.isFinite(Number(value))));
}

export async function postHyxiSyncEnergyHistory(req, res) {
  if (!validQuery(req.query)) return res.status(400).json({ error: 'timeType o startTime inválidos' });
  try {
    const result = await syncHyxiEnergyHistory(req.params.plantId, Number(req.query.timeType), req.query.startTime);
    return res.status(result.failed ? 502 : 200).json(result);
  } catch (error) {
    return res.status(error.statusCode ?? 502).json({ error: error.message });
  }
}

export async function getStoredEnergyHistory(req, res) {
  if (!validQuery(req.query)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.plantId)) {
    return res.status(400).json({ error: 'plantId, timeType o startTime inválidos' });
  }
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  try {
    const timeType = Number(req.query.timeType);
    let rows = await listEnergyIntervals(req.params.plantId, timeType, req.query.startTime);
    if (!hasEnergyValues(rows) && timeType === 1) {
      const plant = await getStoredPlantById(req.params.plantId);
      if (plant?.provider === 'hyxi' && plant.active && plant.external_plant_id) {
        await syncHyxiEnergyHistory(plant.external_plant_id, 1, req.query.startTime);
      } else if (plant?.provider === 'growatt' && plant.active) {
        await syncGrowattEnergyHistory(plant, req.query.startTime);
      }
      rows = await listEnergyIntervals(req.params.plantId, 1, req.query.startTime);
    }
    return res.json(rows);
  } catch (error) {
    if (error?.frequentAccess) return res.status(503).json({ error: 'FREQUENTLY_ACCESS' });
    return res.status(503).json({ error: 'No se pudo consultar el histórico energético' });
  }
}
