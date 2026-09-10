import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { syncHyxiEnergySummary } from '../services/hyxiEnergySummary.service.js';
import { syncHyxiRealtime } from '../services/hyxiRealtime.service.js';
import { syncHyxiDeviceDetails } from '../services/hyxiDeviceDetails.service.js';
import { syncHyxiDevices } from '../services/hyxiDevices.service.js';
import { syncHyxiPlants } from '../services/hyxiPlants.service.js';
import { syncHyxiPlantDetails } from '../services/hyxiPlantDetails.service.js';

const provider = new HyxiProvider();

export async function getHyxiPlantAlarms(req, res) {
  const parsePage = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return NaN;
    return Number(value);
  };
  const currentPage = parsePage(req.query.currentPage, 1);
  const pageSize = parsePage(req.query.pageSize, 100);
  if (!Number.isSafeInteger(currentPage) || currentPage < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    return res.status(400).json({
      provider: 'hyxi', error: 'currentPage and pageSize must be positive integers',
    });
  }
  try {
    return res.json(await provider.getPlantAlarms(req.params.plantId, currentPage, pageSize));
  } catch {
    return res.status(502).json({ provider: 'hyxi', error: 'HYXi plant alarms request failed' });
  }
}

export async function getHyxiPlantPowerHistory(req, res) {
  const { startTime } = req.query;
  if (typeof startTime !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startTime)
      || !Number.isFinite(Date.parse(startTime))
      || new Date(startTime).toISOString().slice(0, 10) !== startTime) {
    return res.status(400).json({
      provider: 'hyxi', error: 'startTime must be a valid YYYY-MM-DD date',
    });
  }
  try {
    return res.json(await provider.getPlantPowerHistory(req.params.plantId, startTime));
  } catch {
    return res.status(502).json({ provider: 'hyxi', error: 'HYXi plant power history request failed' });
  }
}

export async function getHyxiPlantEnergyHistory(req, res) {
  const { timeType, startTime } = req.query;
  if (typeof timeType !== 'string' || !/^[123]$/.test(timeType)
      || typeof startTime !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startTime)
      || !Number.isFinite(Date.parse(startTime))
      || new Date(startTime).toISOString().slice(0, 10) !== startTime) {
    return res.status(400).json({
      provider: 'hyxi', error: 'timeType must be 1, 2 or 3 and startTime must be a valid YYYY-MM-DD date',
    });
  }
  try {
    return res.json({
      provider: 'hyxi',
      plantId: req.params.plantId,
      timeType: Number(timeType),
      startTime,
      ...await provider.getPlantEnergyHistory(req.params.plantId, Number(timeType), startTime),
    });
  } catch {
    return res.status(502).json({ provider: 'hyxi', error: 'HYXi plant energy history request failed' });
  }
}

export async function postHyxiSyncEnergySummary(req, res) {
  try {
    return res.json(await syncHyxiEnergySummary());
  } catch {
    return res.status(502).json({ provider: 'hyxi', error: 'No se pudo iniciar la sincronización del resumen energético' });
  }
}

export async function getHyxiPlantEnergySummary(req, res) {
  try {
    return res.json({
      provider: 'hyxi',
      energy: await provider.getPlantEnergySummary(req.params.plantId),
    });
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'HYXi plant energy summary request failed',
    });
  }
}

export async function postHyxiSyncRealtime(req, res) {
  try {
    return res.json(await syncHyxiRealtime());
  } catch {
    return res.status(502).json({ provider: 'hyxi', error: 'No se pudo iniciar la sincronización realtime HYXi' });
  }
}

export async function getHyxiDeviceRealtime(req, res) {
  try {
    return res.json({
      provider: 'hyxi',
      realtime: await provider.getDeviceRealtime(req.params.deviceSn),
    });
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'HYXi device realtime request failed',
    });
  }
}

export async function postHyxiSyncDeviceDetails(req, res) {
  try {
    return res.json(await syncHyxiDeviceDetails());
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'No se pudieron consultar los dispositivos para sincronizar detalles HYXi',
    });
  }
}

export async function getHyxiDevice(req, res) {
  try {
    return res.json({
      provider: 'hyxi',
      device: await provider.getDevice(req.params.deviceSn),
    });
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'HYXi device request failed',
    });
  }
}

export async function postHyxiSyncDevices(req, res) {
  try {
    return res.json(await syncHyxiDevices());
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'No se pudieron consultar las plantas para sincronizar dispositivos HYXi',
    });
  }
}

export async function postHyxiSyncPlantDetails(req, res) {
  try {
    return res.json(await syncHyxiPlantDetails());
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'No se pudieron consultar las plantas para sincronizar sus detalles HYXi',
    });
  }
}

export async function getHyxiPlant(req, res) {
  try {
    return res.json({
      provider: 'hyxi',
      plant: await provider.getPlant(req.params.plantId),
    });
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'HYXi plant request failed',
    });
  }
}

export async function postHyxiSyncPlants(req, res) {
  try {
    return res.json(await syncHyxiPlants());
  } catch (error) {
    return res.status(error.statusCode === 409 ? 409 : 502).json({
      provider: 'hyxi',
      error: error.statusCode === 409 ? error.message : 'No se pudo sincronizar la lista de plantas HYXi',
    });
  }
}

export async function getHyxiPlants(req, res) {
  const parsePage = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return NaN;
    return Number(value);
  };
  const currentPage = parsePage(req.query.currentPage, 1);
  const pageSize = parsePage(req.query.pageSize, 20);

  if (!Number.isSafeInteger(currentPage) || currentPage < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    return res.status(400).json({
      provider: 'hyxi',
      error: 'currentPage and pageSize must be positive integers',
    });
  }

  try {
    return res.json(await provider.listPlants({ currentPage, pageSize }));
  } catch {
    return res.status(502).json({
      provider: 'hyxi',
      error: 'HYXi plants request failed',
    });
  }
}

export async function getHyxiHealth(req, res) {
  try {
    await provider.authenticate();
    return res.json({
      status: 'ok',
      provider: 'hyxi',
      authenticated: true,
    });
  } catch {
    return res.status(503).json({
      status: 'error',
      provider: 'hyxi',
      authenticated: false,
    });
  }
}
