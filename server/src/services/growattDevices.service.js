import { upsertGrowattDevice } from '../repositories/devices.repository.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { normalizeGrowattDevice } from '../providers/growatt/normalizeGrowattDevice.js';

const provider = new GrowattProvider();

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