import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { resolveHyxiPlant, upsertEnergyIntervals } from '../repositories/energyIntervals.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiEnergyHistory(externalPlantId, timeType, startTime) {
  const plantId = await resolveHyxiPlant(externalPlantId);
  const history = await provider.getPlantEnergyHistory(externalPlantId, timeType, startTime);
  const updatedAt = new Date().toISOString();
  const rows = history.points.map(point => ({
    plant_id: plantId,
    provider: 'hyxi',
    interval_type: timeType,
    interval_start: point.timestamp,
    timezone: history.timeZone,
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
