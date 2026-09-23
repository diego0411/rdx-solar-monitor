import { syncHyxiEnergyHistory } from '../services/hyxiEnergyHistory.service.js';
import { syncGrowattEnergyHistory, syncGrowattEnergyRollups } from '../services/growattEnergyHistory.service.js';
import { listEnergyIntervals, listEnergyIntervalsRange } from '../repositories/energyIntervals.repository.js';
import { getStoredPlantById } from '../repositories/plants.repository.js';
import { plantInScope } from '../middleware/authorization.middleware.js';
import { localDateKey } from '../utils/timezone.js';
import { aggregateHistory, energyTimeType, periodRange } from '../services/historyPeriods.js';

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
  const period = req.query.period ?? null;
  if (!validQuery(req.query) || (period !== null && !['day', 'week', 'month', 'year'].includes(period))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.plantId)) {
    return res.status(400).json({ error: 'plantId, timeType o startTime inválidos' });
  }
  if (!plantInScope(req.scope, req.params.plantId.toLowerCase())) {
    return res.status(404).json({ error: 'Planta no encontrada' });
  }
  try {
    const expectedType = energyTimeType(period);
    const timeType = period ? expectedType : Number(req.query.timeType);
    let rows = await listEnergyIntervals(req.params.plantId, timeType, req.query.startTime);
    if (!hasEnergyValues(rows)) {
      const plant = await getStoredPlantById(req.params.plantId);
      if (plant?.provider === 'hyxi' && plant.active && plant.external_plant_id) {
        await syncHyxiEnergyHistory(plant.external_plant_id, timeType, req.query.startTime);
      } else if (plant?.provider === 'growatt' && plant.active) {
        if (timeType === 1) await syncGrowattEnergyHistory(plant, req.query.startTime);
        else await syncGrowattEnergyRollups(plant, period, req.query.startTime);
      }
      rows = await listEnergyIntervals(req.params.plantId, timeType, req.query.startTime);
    }
    if (!period) return res.json(rows);
    if (period === 'day') {
      return res.json({
        period, start: req.query.startTime, end: periodRange('day', req.query.startTime).end,
        bucket: 'intraday', buckets: rows,
      });
    }
    const range = periodRange(period, req.query.startTime);
    rows = await listEnergyIntervalsRange(req.params.plantId, timeType, range.start, range.end);
    return res.json(aggregateHistory(rows, {
      period, selectedDate: req.query.startTime, kind: 'energy',
      localDate: row => localDateKey(row.interval_start, row.timezone),
    }));
  } catch (error) {
    if (error?.frequentAccess) return res.status(503).json({ error: 'FREQUENTLY_ACCESS' });
    return res.status(503).json({ error: 'No se pudo consultar el histórico energético' });
  }
}
