import { upsertGrowattDevice } from '../repositories/devices.repository.js';
import { linkGrowattDeviceToPlant } from '../repositories/devices.repository.js';
import { listActiveGrowattPlants } from '../repositories/plants.repository.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { normalizeGrowattDevice } from '../providers/growatt/normalizeGrowattDevice.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const provider = new GrowattProvider();
const LINK_PROGRESS_FILE = new URL('../../.cache/growatt-device-plant-links.json', import.meta.url);

function readLinkProgress() {
  if (!existsSync(LINK_PROGRESS_FILE)) return {};
  try {
    const progress = JSON.parse(readFileSync(LINK_PROGRESS_FILE, 'utf8'));
    return progress && typeof progress === 'object' ? progress : {};
  } catch {
    return {};
  }
}

export async function syncGrowattDevices({ forceCached = false } = {}) {
  const devices = await provider.listDevices({ forceCached });
  const result = {
    provider: 'growatt', fetched: devices.length, inserted: 0, updated: 0, failed: 0, errors: [],
  };

  for (const device of devices) {
    try {
      const action = await upsertGrowattDevice(normalizeGrowattDevice(device));
      result[action] += 1;
    } catch (error) {
      result.failed += 1;
      const serial = String(device?.deviceSn ?? '');
      result.errors.push({
        device_type: device?.deviceType ?? null,
        serial_suffix: serial ? serial.slice(-4) : null,
        error_message: error instanceof Error ? error.message : 'Unknown Growatt device error',
      });
    }
  }
  return result;
}

export async function linkNextGrowattPlantDevices() {
  const plants = await listActiveGrowattPlants();
  const progress = readLinkProgress();
  const pendingPlants = plants.filter(item => !progress[item.external_plant_id]);
  const plant = pendingPlants[0];
  const result = {
    provider: 'growatt', processed_plant: null, remaining_plants: pendingPlants.length,
    fetched: 0, linked: 0, failed: 0, rate_limited: false, errors: [],
  };
  if (!plant) return result;

  result.processed_plant = plant.external_plant_id;
  try {
    const devices = await provider.listPlantDevices(plant.external_plant_id);
    const realDevices = devices.filter(device => device?.device_sn
      && device.device_sn !== 'meter');
    result.fetched = realDevices.length;
    for (const device of realDevices) {
      result.linked += await linkGrowattDeviceToPlant(device.device_sn, plant.id);
    }
    progress[plant.external_plant_id] = true;
    mkdirSync(new URL('../../.cache/', import.meta.url), { recursive: true });
    writeFileSync(LINK_PROGRESS_FILE, JSON.stringify(progress), 'utf8');
    result.remaining_plants = plants.filter(item => !progress[item.external_plant_id]).length;
  } catch (error) {
    result.failed = 1;
    result.rate_limited = error?.rateLimited === true;
    result.errors.push(error instanceof Error ? error.message : 'Error de vinculación Growatt');
  }
  return result;
}
