import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { listActiveHyxiPlants } from '../repositories/plants.repository.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 20;
const MAX_ALARMS = 20;

function findAlarmArrays(value, found = []) {
  if (Array.isArray(value)) {
    if (value.every(item => item && typeof item === 'object' && !Array.isArray(item))) found.push(value);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const nested of Object.values(value)) findAlarmArrays(nested, found);
  return found;
}

export function extractAlarmItems(payload) {
  const arrays = findAlarmArrays(payload?.data);
  return arrays.sort((left, right) => right.length - left.length)[0] ?? [];
}

function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizedMessage(error) {
  const message = String(error?.providerMsg ?? error?.message ?? 'HYXi alarm request failed');
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 300);
}

export function alarmTimestamp(alarm) {
  if (!alarm || typeof alarm !== 'object') return null;
  const timestamps = Object.entries(alarm)
    .filter(([key]) => /(time|date)/i.test(key))
    .map(([, value]) => parseTime(value)).filter(value => value !== null);
  return timestamps.length ? Math.max(...timestamps) : null;
}

export function createHyxiRecentAlarmsService({
  listPlants = listActiveHyxiPlants,
  provider = new HyxiProvider(),
  now = () => Date.now(),
} = {}) {
  let cached = null;
  let cachedAt = 0;
  let filling = null;

  async function fillCache(scopePlantIds = null) {
    const allPlants = await listPlants();
    const plants = scopePlantIds === null || scopePlantIds === undefined
      ? allPlants
      : allPlants.filter(plant => scopePlantIds.has(plant.id));
    const alarms = [];
    const failures = [];
    let failedPlants = 0;
    for (const plant of plants) {
      try {
        const payload = await provider.getPlantAlarms(plant.external_plant_id, 1, PAGE_SIZE);
        for (const alarm of extractAlarmItems(payload)) {
          alarms.push({
            plant: {
              id: plant.id,
              external_plant_id: plant.external_plant_id,
              name: plant.name,
            },
            alarm,
          });
        }
      } catch (error) {
        failedPlants += 1;
        if (process.env.NODE_ENV !== 'production') {
          failures.push({
            plant_id: plant.id,
            external_plant_id: plant.external_plant_id,
            http_status: error?.httpStatus ?? error?.statusCode ?? null,
            provider_code: error?.providerCode ?? null,
            provider_msg: sanitizedMessage(error),
          });
        }
        console.error('HYXi recent alarms plant failed:', {
          plant_id: plant.id,
          external_plant_id: plant.external_plant_id,
          plant_name: plant.name,
          http_status: error?.httpStatus ?? error?.statusCode ?? null,
          provider_code: error?.providerCode ?? null,
          message: sanitizedMessage(error),
        });
      }
    }
    const sorted = alarms.map((item, index) => ({ item, index, timestamp: alarmTimestamp(item.alarm) }))
      .sort((left, right) => {
        if (left.timestamp === null && right.timestamp === null) return left.index - right.index;
        if (left.timestamp === null) return 1;
        if (right.timestamp === null) return -1;
        return right.timestamp - left.timestamp || left.index - right.index;
      }).slice(0, MAX_ALARMS).map(entry => entry.item);
    const result = {
      alarms: sorted,
      fetched_at: new Date(now()).toISOString(),
      partial: failedPlants > 0,
      checked_plants: plants.length,
      failed_plants: failedPlants,
      ...(process.env.NODE_ENV !== 'production' ? { failures } : {}),
    };
    if (scopePlantIds === null || scopePlantIds === undefined) {
      cached = result;
      cachedAt = now();
    }
    return result;
  }

  function emptyResult() {
    return {
      alarms: [],
      fetched_at: new Date(now()).toISOString(),
      partial: false,
      checked_plants: 0,
      failed_plants: 0,
      ...(process.env.NODE_ENV !== 'production' ? { failures: [] } : {}),
    };
  }

  return async function getRecentHyxiAlarms(plantIds = null) {
    if (plantIds !== null && plantIds !== undefined) {
      if (plantIds.size === 0) return emptyResult();
      return fillCache(plantIds);
    }
    if (cached && now() - cachedAt < CACHE_TTL_MS) return cached;
    if (!filling) filling = fillCache().finally(() => { filling = null; });
    return filling;
  };
}

export const getRecentHyxiAlarms = createHyxiRecentAlarmsService();
