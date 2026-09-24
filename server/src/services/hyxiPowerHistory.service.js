import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiPowerHistory } from '../providers/hyxi/normalizeHyxiPowerHistory.js';
import { resolveHyxiPlant } from '../repositories/energyIntervals.repository.js';
import { upsertPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';

const provider = new HyxiProvider();

const DEFAULT_TIMEZONE = 'America/La_Paz';

export function localDateForTimezone(now, timezone = DEFAULT_TIMEZONE) {
  const zone = String(timezone ?? '').trim() || DEFAULT_TIMEZONE;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return localDateForTimezone(now, DEFAULT_TIMEZONE);
  }
}

export function previousDate(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function buildHyxiPowerHistoryRows(response, plantId, updatedAt) {
  const byTimestamp = new Map(normalizeHyxiPowerHistory(response).map(point => [
    point.interval_start,
    { ...point, plant_id: plantId, provider: 'hyxi', updated_at: updatedAt },
  ]));
  return [...byTimestamp.values()];
}

export async function syncHyxiPowerHistory(externalPlantId, startTime) {
  const plantId = await resolveHyxiPlant(externalPlantId);
  const response = await provider.getPlantPowerHistory(externalPlantId, startTime);
  const updatedAt = new Date().toISOString();
  const rows = buildHyxiPowerHistoryRows(response, plantId, updatedAt);
  const result = { fetched: rows.length, upserted: 0, failed: 0 };
  try {
    await upsertPlantPowerIntervals(rows);
    result.upserted = rows.length;
  } catch {
    result.failed = rows.length;
  }
  return result;
}

export function createHyxiPowerHistoryWindowSync({
  sync = syncHyxiPowerHistory,
  now = () => new Date(),
} = {}) {
  const completedClosures = new Set();

  return async function syncHyxiPowerHistoryWindow(plant) {
    const currentDate = localDateForTimezone(now(), plant.timezone);
    const priorDate = previousDate(currentDate);
    const closureKey = `${plant.id ?? plant.external_plant_id}:${priorDate}`;
    const result = { current_date: currentDate, prior_date: priorDate, current: null, closure: null, errors: [] };

    try {
      result.current = await sync(plant.external_plant_id, currentDate);
    } catch (error) {
      result.errors.push({ period: 'current', date: currentDate, error });
    }

    if (!completedClosures.has(closureKey)) {
      try {
        result.closure = await sync(plant.external_plant_id, priorDate);
        if (result.closure?.failed === 0) completedClosures.add(closureKey);
      } catch (error) {
        result.errors.push({ period: 'closure', date: priorDate, error });
      }
    } else {
      result.closure = { skipped: true, date: priorDate };
    }

    return result;
  };
}

export const syncHyxiPowerHistoryWindow = createHyxiPowerHistoryWindowSync();
