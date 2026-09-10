import { syncHyxiEnergyHistory } from '../services/hyxiEnergyHistory.service.js';
import { listEnergyIntervals } from '../repositories/energyIntervals.repository.js';

function validQuery({ timeType, startTime }) {
  return typeof timeType === 'string' && /^[123]$/.test(timeType)
    && typeof startTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startTime)
    && Number.isFinite(Date.parse(startTime))
    && new Date(startTime).toISOString().slice(0, 10) === startTime;
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
  try {
    return res.json(await listEnergyIntervals(req.params.plantId, Number(req.query.timeType), req.query.startTime));
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el histórico energético' });
  }
}
