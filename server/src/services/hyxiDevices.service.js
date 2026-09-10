import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiDevicePage } from '../providers/hyxi/normalizeHyxiDevicePage.js';
import { listActiveHyxiPlants } from '../repositories/plants.repository.js';
import { upsertDevice } from '../repositories/devices.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiDevices() {
  const plants = await listActiveHyxiPlants();
  const result = { provider: 'hyxi', plants: plants.length, fetched: 0, synced: 0, failed: 0 };
  const pageSize = 100;
  for (const plant of plants) {
    try {
      for (let currentPage = 1; ; currentPage += 1) {
        const page = await provider.listDevices(plant.external_plant_id, { currentPage, pageSize });
        result.fetched += page.devices.length;
        for (const device of page.devices) {
          try {
            await upsertDevice(normalizeHyxiDevicePage(device, plant.id));
            result.synced += 1;
          } catch {
            result.failed += 1;
          }
        }
        if (currentPage * pageSize >= page.total) break;
        if (!page.devices.length) throw new Error('Incomplete HYXi device pagination');
      }
    } catch {
      // A failed plant/page counts once; its unknown device count cannot be inferred.
      result.failed += 1;
    }
  }
  return result;
}
