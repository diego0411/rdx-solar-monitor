import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiPowerHistory } from '../providers/hyxi/normalizeHyxiPowerHistory.js';
import { resolveHyxiPlant } from '../repositories/energyIntervals.repository.js';
import { upsertPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiPowerHistory(externalPlantId, startTime) {
  const plantId = await resolveHyxiPlant(externalPlantId);
  const response = await provider.getPlantPowerHistory(externalPlantId, startTime);
  const updatedAt = new Date().toISOString();
  const rows = normalizeHyxiPowerHistory(response).map(point => ({
    ...point, plant_id: plantId, provider: 'hyxi', updated_at: updatedAt,
  }));
  const result = { fetched: rows.length, upserted: 0, failed: 0 };
  try {
    await upsertPlantPowerIntervals(rows);
    result.upserted = rows.length;
  } catch {
    result.failed = rows.length;
  }
  return result;
}
