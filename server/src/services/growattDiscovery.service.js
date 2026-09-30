import { listStoredDevices, upsertGrowattDevice } from '../repositories/devices.repository.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { normalizeGrowattDiscovery } from '../providers/growatt/normalizeGrowattDiscovery.js';
import { linkPlantMeters } from './growattDevices.service.js';

const provider = new GrowattProvider();
let running = false;

export async function discoverGrowattPlant(plant) {
  if (running) return { skipped: true };
  running = true;
  const result = { plants: 0, inserted: 0, updated: 0, unidentified: 0, failed: 0,
    rate_limited: false, meters_fetched: 0, meters_linked: 0, meter_failed: 0, errors: [] };
  try {
    // Include unlinked devices so discovery reuses their identity and metadata.
    const stored = (await listStoredDevices()).filter(device => device.provider === 'growatt');
    const bySerial = new Map(stored.map(device => [device.serial_number, device]));
      try {
        const entries = await provider.listPlantDevices(plant.external_plant_id);
        result.plants += 1;
        const real = entries.filter(entry => String(entry?.device_sn ?? '').trim()
          && String(entry.device_sn).trim().toLowerCase() !== 'meter');
        for (const entry of real) {
          try {
            const serial = String(entry.device_sn).trim();
            const existing = bySerial.get(serial);
            // Never silently move an inverter already assigned to another plant.
            if (existing?.plant_id && existing.plant_id !== plant.id) { result.failed += 1; continue; }
            const known = String(existing?.device_type ?? '').toLowerCase() === 'min';
            const identification = known ? null : await provider.checkDeviceBySn(serial);
            const device = normalizeGrowattDiscovery(entry, plant.id, existing, identification);
            if (!device) { result.unidentified += 1; continue; }
            const action = await upsertGrowattDevice(device);
            result[action] += 1;
            bySerial.set(serial, { ...existing, ...device });
          } catch (error) {
            result.failed += 1;
            if (error?.rateLimited) { result.rate_limited = true; break; }
          }
        }
        if (!result.rate_limited) await linkPlantMeters(plant, real, result);
      } catch (error) {
        result.failed += 1;
        if (error?.rateLimited) result.rate_limited = true;
      }
  } catch {
    result.failed += 1;
  } finally {
    running = false;
  }
  // Never log upstream messages, credentials or payloads.
  const { errors, ...summary } = result;
  console.info('Growatt automatic discovery', summary);
  return summary;
}
