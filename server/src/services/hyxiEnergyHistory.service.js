import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { resolveHyxiPlant, upsertEnergyIntervals } from '../repositories/energyIntervals.repository.js';
import { listPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';

const provider = new HyxiProvider();

const derivedFields = {
  generation_power_w: 'generation_kwh',
  consumption_power_w: 'consumption_kwh',
  grid_import_power_w: 'grid_import_kwh',
  grid_export_power_w: 'grid_export_kwh',
};

function energyFromPower(value, intervalHours) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const power = Number(value);
  return Number.isFinite(power) ? power * intervalHours / 1000 : null;
}

async function deriveFromPowerHistory(plantId, startTime) {
  const powerRows = await listPlantPowerIntervals(plantId, startTime);
  const points = [];
  for (let index = 0; index < powerRows.length - 1; index += 1) {
    const current = powerRows[index];
    const next = powerRows[index + 1];
    const intervalMs = Date.parse(next.interval_start) - Date.parse(current.interval_start);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) continue;
    const intervalHours = intervalMs / 3600000;
    points.push({
      timestamp: current.interval_start,
      timezone: current.timezone,
      ...Object.fromEntries(Object.entries(derivedFields).map(([powerField, energyField]) => [
        energyField, energyFromPower(current[powerField], intervalHours),
      ])),
      battery_charge_kwh: null,
      battery_discharge_kwh: null,
      raw_data: {
        derived_from: 'plant_power_intervals',
        interval_end: next.interval_start,
        interval_hours: intervalHours,
        power_interval_id: current.id,
      },
    });
  }
  return points;
}

export async function syncHyxiEnergyHistory(externalPlantId, timeType, startTime) {
  const plantId = await resolveHyxiPlant(externalPlantId);
  const history = await provider.getPlantEnergyHistory(externalPlantId, timeType, startTime);
  const hasEnergy = history.points.some(point => [
    point.generation_kwh,
    point.consumption_kwh,
    point.grid_import_kwh,
    point.grid_export_kwh,
  ].some(value => value !== null && value !== undefined));
  const points = !hasEnergy && timeType === 1
    ? await deriveFromPowerHistory(plantId, startTime)
    : history.points;
  const updatedAt = new Date().toISOString();
  const rows = points.map(point => ({
    plant_id: plantId,
    provider: 'hyxi',
    interval_type: timeType,
    interval_start: point.timestamp,
    timezone: point.timezone ?? history.timeZone,
    generation_kwh: point.generation_kwh,
    consumption_kwh: point.consumption_kwh,
    battery_charge_kwh: point.battery_charge_kwh,
    battery_discharge_kwh: point.battery_discharge_kwh,
    grid_import_kwh: point.grid_import_kwh,
    grid_export_kwh: point.grid_export_kwh,
    raw_data: point.raw_data,
    updated_at: updatedAt,
  }));
  const result = { fetched: rows.length, upserted: 0, failed: 0 };
  try {
    await upsertEnergyIntervals(rows);
    result.upserted = rows.length;
  } catch {
    result.failed = rows.length;
  }
  return result;
}
